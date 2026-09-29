export async function createSample(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 3200
  canvas.height = 1800
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot create the sample image.')

  const sky = context.createLinearGradient(0, 0, 0, 1800)
  sky.addColorStop(0, '#1a244c')
  sky.addColorStop(0.46, '#ba809b')
  sky.addColorStop(0.75, '#efbda4')
  sky.addColorStop(1, '#616f92')
  context.fillStyle = sky
  context.fillRect(0, 0, 3200, 1800)

  const glow = context.createRadialGradient(2150, 660, 60, 2150, 660, 850)
  glow.addColorStop(0, '#ffd6b677')
  glow.addColorStop(1, '#ffd6b600')
  context.fillStyle = glow
  context.fillRect(0, 0, 3200, 1800)
  context.fillStyle = '#ffe3c4'
  context.beginPath()
  context.arc(2150, 660, 150, 0, Math.PI * 2)
  context.fill()

  const ridges = [
    { color: '#6a6689', base: 1140, amplitude: 220, phase: 0.2 },
    { color: '#444d74', base: 1300, amplitude: 210, phase: 1.8 },
    { color: '#293954', base: 1500, amplitude: 180, phase: 3.2 },
    { color: '#172b40', base: 1720, amplitude: 220, phase: 4.5 },
  ]
  for (const ridge of ridges) {
    context.beginPath()
    context.moveTo(0, 1800)
    for (let x = 0; x <= 3200; x += 8) {
      const y = ridge.base + Math.sin(x / 460 + ridge.phase) * ridge.amplitude
        + Math.sin(x / 185 + ridge.phase) * ridge.amplitude * 0.3
        + Math.sin(x / 72 + ridge.phase) * 10
      context.lineTo(x, y)
    }
    context.lineTo(3200, 1800)
    context.closePath()
    context.fillStyle = ridge.color
    context.fill()
  }

  try {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Could not create the sample image.')),
      'image/png',
    ))
    return new File([blob], 'afterglow-sample.png', { type: 'image/png' })
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}
