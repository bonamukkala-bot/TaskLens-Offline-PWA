export async function capturePhoto(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 960;
  const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Camera canvas is not available.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const luminance = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
    image.data[i] = contrast;
    image.data[i + 1] = contrast;
    image.data[i + 2] = contrast;
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))), 'image/jpeg', 0.88);
  });
}
