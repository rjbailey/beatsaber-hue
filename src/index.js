require('dotenv').config()
const {dtls} = require('node-dtls-client')
const fs = require('fs')
const rgbToXy = require('./helpers/rgbToXy')
const rp = require('request-promise')
const semver = require('semver')
const WebSocket = require('ws')

const COLORS = {
  a: '255,0,0',
  b: '0,0,255',
  ab: '205,3,219',
  idle: '255,255,255',
  idleDark: '0,0,0'
}

class HueSync {
  constructor () {
    this.bridgeIp = process.env.BRIDGE_IP
    this.bridgeUri = `http://${this.bridgeIp}`
    this.auth = null
    this.lastColor = COLORS.idle
    this.lightingBuffer = null
    this.config = null
    this.dtlsSocket = null
    this.interval = null
    this.groupId = null
    this.state = null

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

  stream () {
    this.createLightingBuffer()

    // setInterval(() => {
    //   if (Math.random() < 0.3) {
    //     const colors = [COLORS.a, COLORS.a, COLORS.a, COLORS.b, COLORS.b, COLORS.b, COLORS.ab].filter(c => c !== this.lastColor)
    //
    //     this.lastColor = colors[Math.floor(Math.random() * colors.length)]
    //     this.createLightingBuffer()
    //   }
    // }, 200)

    this.interval = setInterval(() => {
      this.dtlsSocket.send(this.lightingBuffer)
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

    this.groupId = Object.keys(this.state.groups).find(
      key => this.state.groups[key].type === 'Entertainment' &&
        this.state.groups[key].name === process.env.GROUP_NAME
    )

    if (!this.groupId) {
      console.error(
        `Unable to find entertainment group with name "${process.env.GROUP_NAME}", available options are:`,
        Object.values(this.state.groups).filter(group => group.type === 'Entertainment').reduce((a, b) => {
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
          this.lastColor = COLORS.idle
          this.createLightingBuffer()
          console.log('Connected to Beat Saber!')
          break
        case 'songStart':
          this.lastColor = COLORS.idleDark
          this.createLightingBuffer()
          break
        case 'noteCut':
          if (
            (data.noteCut.noteType === 'NoteA' || data.noteCut.noteType === 'NoteB') &&
            data.noteCut.speedOK &&
            data.noteCut.directionOK &&
            data.noteCut.saberTypeOK &&
            !data.noteCut.wasCutTooSoon
          ) {
            this.lastColor = data.noteCut.noteType === 'NoteA' ? COLORS.a : COLORS.b
            this.createLightingBuffer()
          }
          console.log('A note has been cut', data)
          break
        case 'finished':
          this.lastColor = COLORS.idle
          this.createLightingBuffer()
          break
        case 'pause':
          this.lastColor = COLORS.idle
          this.createLightingBuffer()
          break
        case 'resume':
          this.lastColor = COLORS.idleDark
          this.createLightingBuffer()
          break
      }
    }
  }

  async authenticate () {
    let auth = JSON.parse(fs.readFileSync('auth.json'))

    if (auth && auth.username) {
      const res = await rp({
        uri: `${this.bridgeUri}/api/${auth.username}`,
        json: true
      })

      if (typeof res.groups !== 'undefined') {
        this.auth = auth
        this.state = res

        return
      }
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

  createLightingBuffer () {
    const lights = []

    this.state.groups[this.groupId].lights.forEach(light => {
      const lightId = light.padStart(2, '0').split('')
      const color = rgbToXy(...this.lastColor.split(','))
      const brightness = this.state.lights[light].state.bri

      lights.push(Buffer.from([
        0x00, lightId[0], lightId[1],
        color.x.xOne, color.x.xTwo, color.y.yOne, color.y.yTwo, brightness, brightness
      ]))
    })

    this.lightingBuffer = Buffer.concat([
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
      ...lights
    ])
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
