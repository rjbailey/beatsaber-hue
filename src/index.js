require('dotenv').config()
const fs = require('fs')
const rp = require('request-promise')
const semver = require('semver')

class HueSync {
  constructor () {
    this.bridgeIp = process.env.BRIDGE_IP
    this.bridgeUri = `http://${this.bridgeIp}`
    this.auth = null
    this.config = null
    this.groupId = null
    this.state = null
  }

  async start () {
    this.config = await rp({
      uri: `${this.bridgeUri}/api/config`,
      json: true
    })

    if (semver.lt(this.config.apiversion, '1.22.0')) {
      console.error('Your bridge must be running at least version 1.22')

      return
    }

    await this.authenticate()

    if (!this.auth) {
      console.error('Unable to retrieve authentication string')

      return
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

      return
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

      return
    }

    console.log('And we are go!')
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

  responseIsError (res) {
    return typeof res[0] !== 'undefined' && typeof res[0].error !== 'undefined'
  }
}

new HueSync().start()
