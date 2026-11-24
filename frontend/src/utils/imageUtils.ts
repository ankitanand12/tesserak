export const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const maxWidth = 300; // Max width in pixels
    const maxHeight = 300; // Max height in pixels
    const maxSizeMB = 0.2; // Max size in MB (200KB)
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Start with high quality
        let quality = 0.9;
        let base64String = canvas.toDataURL('image/jpeg', quality);
        
        // Reduce quality until size is under maxSizeMB
        while (base64String.length > maxSizeMB * 1024 * 1024 && quality > 0.1) {
          quality -= 0.1;
          base64String = canvas.toDataURL('image/jpeg', quality);
        }
        
        resolve(base64String);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
  });
};
