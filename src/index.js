require('dotenv').config()
const {dtls} = require('node-dtls-client')
const fs = require('fs')
const rgbToXy = require('./helpers/rgbToXy')
const rp = require('request-promise')
const semver = require('semver')
const WebSocket = require('ws')

const COLORS = {
  a: '179,4,4',
  b: '4,150,215',
  idle: '255,255,255',
  idleDark: '0,0,0'
}

class HueSync {
  constructor () {
    this.auth = null
    this.bridgeIp = process.env.BRIDGE_IP
    this.bridgeUri = `http://${this.bridgeIp}`
    this.config = null
    this.currentBrightness = null
    this.dtlsSocket = null
    this.fading = false
    this.groupId = null
    this.groups = null
    this.interval = null
    this.lightingBuffer = null
    this.mode = process.env.MODE || 'lighting'

    if (['notes', 'lighting'].indexOf(this.mode) === -1) {
      console.error('Invalid mode set, falling back to default')
      this.mode = 'lighting'
    }

    Object.keys(COLORS).forEach(key => {
      const envKey = `COLOR_${key.toUpperCase()}`

      if (process.env[envKey]) {
        if (!/^\d{1,3},\d{1,3},\d{1,3}$/.test(process.env[envKey])) {
          console.error(`Invalid color format for ${envKey}`)

          return
        }

        COLORS[key] = process.env[envKey]
      }
    })
  }

  async start () {
    if (!await this.setupHue()) {
      return
    }

    try {
      await this.setupDtlsSocket()
    } catch (e) {
      console.log('error', e)

      return
    }

    await this.setupWebSocket()

    this.stream()
  }

  stream () {
    this.createLightingBuffer()

    this.interval = setInterval(() => {
      if (this.fading) {
        this.currentBrightness = Math.max(0, this.currentBrightness - 5)
      }

      let brightness = this.currentBrightness

      const buffer = Buffer.concat([
        Buffer.from('HueStream', 'ascii'),
        Buffer.from([
          // Version
          0x01, 0x00,
          // Sequence ID
          0x00,
          // Reserved
          0x00, 0x00,
          // Color mode
          0x01,
          // Reserved
          0x00
        ]),
        ...(this.lightingBuffer.map(a => {
          return Buffer.from(a.map(b => b === 'bri' ? brightness : b))
        }))
      ])

      this.dtlsSocket.send(buffer)
    }, 20)
  }

  async setupHue () {
    this.config = await rp({
      uri: `${this.bridgeUri}/api/config`,
      json: true
    })

    if (semver.lt(this.config.apiversion, '1.22.0')) {
      console.error('Your bridge must be running at least version 1.22')

      return false
    }

    await this.authenticate()

    if (!this.auth) {
      console.error('Unable to retrieve authentication string')

      return false
    }

    this.groupId = Object.keys(this.groups).find(
      key => this.groups[key].type === 'Entertainment' &&
        this.groups[key].name === process.env.GROUP_NAME
    )

    if (!this.groupId) {
      console.error(
        `Unable to find entertainment group with name "${process.env.GROUP_NAME}", available options are:`,
        Object.values(this.groups).filter(group => group.type === 'Entertainment').reduce((a, b) => {
          return `${a}\n${b.name}`
        }, '')
      )

      return false
    }

    const startStream = await rp({
      uri: `${this.bridgeUri}/api/${this.auth.username}/groups/${this.groupId}`,
      method: 'PUT',
      json: true,
      body: {
        stream: {
          active: true
        }
      }
    })

    if (this.responseIsError(startStream)) {
      console.error('Failed to start streaming')

      return false
    }

    return true
  }

  async setupDtlsSocket () {
    return new Promise((resolve, reject) => {
      const psk = {}

      psk[this.auth.username] = Buffer.from(this.auth.clientkey, 'hex')

      this.dtlsSocket = dtls
        .createSocket({
          type: 'udp4',
          address: this.bridgeIp,
          port: 2100,
          psk,
          timeout: 1000,
          ciphers: ['TLS_PSK_WITH_AES_128_GCM_SHA256']
        }).on('connected', () => {
          resolve()
        }).on('error', (e) => {
          reject(e)
        })
    })
  }

  async setupWebSocket () {
    const ws = new WebSocket(process.env.SOCKET_URI)

    ws.onmessage = data => {
      data = JSON.parse(data.data)

      switch (data.event) {
        case 'hello':
          this.createLightingBuffer(COLORS.idle)
          console.log('Connected to Beat Saber!')
          break
        case 'songStart':
          this.createLightingBuffer(COLORS.idleDark)
          break
        case 'noteCut':
          if (
            this.mode === 'notes' &&
            (data.noteCut.noteType === 'NoteA' || data.noteCut.noteType === 'NoteB') &&
            data.noteCut.speedOK &&
            data.noteCut.directionOK &&
            data.noteCut.saberTypeOK &&
            !data.noteCut.wasCutTooSoon
          ) {
            this.createLightingBuffer(data.noteCut.noteType === 'NoteA' ? COLORS.a : COLORS.b)
          }
          console.log('A note has been cut', data)
          break
        case 'beatmapEvent':
          if (
            this.mode === 'lighting' &&
            [0, 1, 2, 3, 4].indexOf(data.beatmapEvent.type) !== -1
          ) {
            switch (data.beatmapEvent.value) {
              case 0:
                this.createLightingBuffer(COLORS.idleDark)
                break
              case 1:
              case 2:
                this.createLightingBuffer(COLORS.b)
                break
              case 3:
                this.createLightingBuffer(COLORS.b, true)
                break
              case 5:
              case 6:
                this.createLightingBuffer(COLORS.a)
                break
              case 7:
                this.createLightingBuffer(COLORS.a, true)
                break
            }
          }
          break
        case 'finished':
          this.createLightingBuffer(COLORS.idle)
          break
        case 'pause':
          this.createLightingBuffer(COLORS.idle)
          break
        case 'resume':
          this.createLightingBuffer(COLORS.idleDark)
          break
      }
    }
  }

  async authenticate () {
    try {
      let auth = JSON.parse(fs.readFileSync('auth.json'))

      if (auth && auth.username) {
        const res = await rp({
          uri: `${this.bridgeUri}/api/${auth.username}/groups`,
          json: true
        })

        if (!this.responseIsError(res)) {
          this.auth = auth
          this.groups = res

          return
        }
      }
    } catch (e) {

    }

    const res = await rp({
      uri: `${this.bridgeUri}/api`,
      method: 'POST',
      json: true,
      body: {
        devicetype: 'beatsaber-hue',
        generateclientkey: true
      }
    })

    if (this.responseIsError(res)) {
      console.error(res[0].error.description)

      return
    }

    if (typeof res[0].success === 'undefined') {
      return
    }

    fs.writeFileSync('auth.json', JSON.stringify(res[0].success))
  }

  async stop () {
    if (this.interval) {
      clearInterval(this.interval)
    }

    if (this.groupId) {
      await rp({
        uri: `${this.bridgeUri}/api/${this.auth.username}/groups/${this.groupId}`,
        method: 'PUT',
        json: true,
        body: {
          stream: {
            active: false
          }
        }
      })
    }

    if (this.dtlsSocket) {
      this.dtlsSocket.close()
    }
  }

  createLightingBuffer (color, fade = false) {
    const lights = []

    color = color || COLORS.idle

    this.groups[this.groupId].lights.forEach(light => {
      const lightId = light.padStart(2, '0').split('')
      const colorXy = rgbToXy(...(color.split(',')))

      lights.push([
        0x00, lightId[0], lightId[1],
        colorXy.x.xOne, colorXy.x.xTwo, colorXy.y.yOne, colorXy.y.yTwo, 'bri', 'bri'
      ])
    })

    let brightness = process.env.BRIGHTNESS || 255

    if (color === COLORS.idleDark) {
      brightness = 0
    }

    this.currentBrightness = brightness
    this.fading = fade
    this.lightingBuffer = lights
  }

  responseIsError (res) {
    return typeof res[0] !== 'undefined' && typeof res[0].error !== 'undefined'
  }
}

const hue = new HueSync()
hue.start()

process.on('SIGINT', () => {
  if (hue) {
    hue.stop().then(() => {
      process.exit(0)
    })

    return
  }

  process.exit(0)
})
