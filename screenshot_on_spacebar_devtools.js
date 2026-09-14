const video = document.querySelector("video");

document.addEventListener("keydown", e => {
  if (e.code !== "Space") return;
  e.preventDefault();

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `frame_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
});