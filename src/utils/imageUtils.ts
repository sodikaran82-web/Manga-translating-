export function resizeImage(file: File): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.src = URL.createObjectURL(file);

  return new Promise(resolve => {
    img.onload = () => {
      const MAX = 1000;
      const scale = Math.min(1, Math.min(MAX / img.width, MAX / img.height));

      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      canvas.toBlob(resolve, "image/jpeg", 0.7);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(img.src);
    };
  });
}

export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = reader.result as string;
      resolve(base64.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
}
