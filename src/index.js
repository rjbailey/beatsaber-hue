require('dotenv').config()
const {dtls} = require('node-dtls-client')
const fs = require('fs')
const {lightZone, lightInZones} = require('./helpers/lightZones')
const rgbToXy = require('./helpers/rgbToXy')
const rp = require('request-promise')
const semver = require('semver')
const WebSocket = require('ws')

const COLORS = {
  a: '179,4,4',
  b: '4,150,215',
  kda: '139,9,153',
  idle: '255,255,255',
  idleDark: '0,0,0'
}

class HueSync {
  constructor () {
    this.auth = null
    this.bridgeIp = process.env.BRIDGE_IP
    this.bridgeUri = `http://${this.bridgeIp}`
    this.config = null
    this.dtlsSocket = null
    this.currentEnvironment = null
    this.groupId = null
    this.groups = null
    this.interval = null
    this.lights = null
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
    this.createLightingBuffer(COLORS.idle)

    this.interval = setInterval(() => {
      const lightingBuffer = Object.values(this.lights).map(light => {
        if (light.fading) {
          light.brightness = Math.max(0, light.brightness - 5)

          if (light.brightness <= 0) {
            light.fading = false
          }
        }

        return Buffer.from(light.buffer.map(b => b === 'bri' ? light.brightness : b))
      })

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
        ...lightingBuffer
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

    const lights = {}

    this.groups[this.groupId].lights.forEach(lightId => {
      lights[lightId] = {
        brightness: null,
        buffer: null,
        fading: false,
        zone: lightZone(this.groups[this.groupId].locations[lightId])
      }
    })

    this.lights = lights

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
          this.currentEnvironment = data.status.beatmap.environmentName
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
            const zones = []

            switch (data.beatmapEvent.type) {
              case 0:
                zones.push('center-front')
                break
              case 1:
                zones.push('left-front')
                zones.push('right-front')
                break
              case 2:
                zones.push('left-back')
                break
              case 3:
                zones.push('right-back')
                break
              case 4:
                zones.push('left-front')
                zones.push('right-front')
                zones.push('center-back')
                break
            }

            switch (data.beatmapEvent.value) {
              case 0:
                this.createLightingBuffer(COLORS.idleDark, zones)
                break
              case 1:
              case 2:
                this.createLightingBuffer(this.currentEnvironment === 'KDAEnvironment' ? COLORS.kda : COLORS.b, zones)
                break
              case 3:
                this.createLightingBuffer(this.currentEnvironment === 'KDAEnvironment' ? COLORS.kda : COLORS.b, zones, true)
                break
              case 5:
              case 6:
                this.createLightingBuffer(COLORS.a, zones)
                break
              case 7:
                this.createLightingBuffer(COLORS.a, zones, true)
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

  createLightingBuffer (color, zones = [], fade = false) {
    const colorXy = rgbToXy(...(color.split(',')))
    const brightness = color === COLORS.idleDark ? 0 : (process.env.BRIGHTNESS || 255)

    Object.keys(this.lights).forEach(lightId => {
      if (lightInZones(this.lights[lightId].zone, zones, this.lights.length)) {
        const lightBufferId = lightId.padStart(2, '0').split('')

        this.lights[lightId].brightness = brightness
        this.lights[lightId].fading = fade
        this.lights[lightId].buffer = [
          0x00, lightBufferId[0], lightBufferId[1],
          colorXy.x.xOne, colorXy.x.xTwo, colorXy.y.yOne, colorXy.y.yTwo, 'bri', 'bri'
        ]
      }
    })
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
