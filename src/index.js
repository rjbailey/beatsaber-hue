require('dotenv').config()
const {dtls} = require('node-dtls-client')
const fs = require('fs')
const hexToBinary = require('hex-to-binary')
const rp = require('request-promise')
const semver = require('semver')

class HueSync {
  constructor () {
    this.bridgeIp = process.env.BRIDGE_IP
    this.bridgeUri = `http://${this.bridgeIp}`
    this.auth = null
    this.lightingBuffer = null
    this.config = null
    this.dtlsSocket = null
    this.interval = null
    this.groupId = null
    this.state = null
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

      lights.push(Buffer.from([
        0x00, lightId[0], lightId[1],
        0xff, 0xff, 0x00, 0x00, 0x00, 0x00 // red
        // 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, // blue
        // 0x0c, 0x0d, 0x00, 0x03, 0x0d, 0x0b, // purple
      ]))
    })

    return Buffer.concat([
      Buffer.from('HueStream', 'ascii'),
      Buffer.from([
        // Version
        0x01, 0x00,
        // Sequence ID
        0x00,
        // Reserved
        0x00, 0x00,
        // Color space
        0x00,
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
