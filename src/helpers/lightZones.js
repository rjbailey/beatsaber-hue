const zones = {
  'left-front': [[-1, 0], [-0.1, 1]],
  'left-back': [[-1, -1], [-0.1, 0]],
  'right-front': [[0.1, 0], [1, 1]],
  'right-back': [[0.1, -1], [1, 0]],
  'center-front': [[-0.1, 0], [0.1, 1]],
  'center-back': [[-0.1, -1], [0.1, 0]]
}

const lightZone = light => {
  return Object.keys(zones).find(key => {
    const zone = zones[key]

    return light[0] >= zone[0][0] && light[0] <= zone[1][0] && light[1] >= zone[0][1] && light[1] <= zone[1][1]
  })
}

const lightInZones = (lightZone, zones, numLights) => {
  if (zones.length < 1) {
    return true
  }

  if (numLights < 2) {
    lightZone = 'center'
  }

  let inZone = false

  for (let zone of zones) {
    if (numLights < 4) {
      const simpleZone = zone.split('-')[0]

      if (lightZone.split('0')[0] === simpleZone) {
        inZone = true

        break
      }

      continue
    }

    if (lightZone === zone) {
      inZone = true

      break
    }
  }

  return inZone
}

module.exports = {
  lightZone,
  lightInZones
}
