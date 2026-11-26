/**
 * Client-Side Cloudinary Integration Utility
 * Enforces strict client-side validation and API routing to secure server endpoints.
 */

export const CLOUDINARY_CLIENT_SIZE_LIMITS = {
  profile: 1 * 1024 * 1024, // 1 MB
  'chat-photo': 2 * 1024 * 1024, // 2 MB
  'chat-video': 50 * 1024 * 1024, // 50 MB
  'chat-voice-note': 10 * 1024 * 1024, // 10 MB
} as const;

export type CloudinaryMediaCategory = keyof typeof CLOUDINARY_CLIENT_SIZE_LIMITS;

export const CLOUDINARY_CLIENT_ERROR_MESSAGES = {
  profile: 'Profile picture size must be 1 MB or less.',
  'chat-photo': 'Photo size must be 2 MB or less.',
  'chat-video': 'Video size must be 50 MB or less.',
  'chat-voice-note': 'Voice note size must be 10 MB or less.',
} as const;

export function validateClientCloudinaryFileSize(
  sizeInBytes: number,
  category: CloudinaryMediaCategory
): void {
  const maxLimit = CLOUDINARY_CLIENT_SIZE_LIMITS[category];
  if (sizeInBytes > maxLimit) {
    throw new Error(CLOUDINARY_CLIENT_ERROR_MESSAGES[category]);
  }
}

export async function compressProfileImageIfNeeded(
  file: File,
  maxBytes: number = CLOUDINARY_CLIENT_SIZE_LIMITS.profile
): Promise<File> {
  if (file.size <= maxBytes || file.type === 'image/gif' || typeof document === 'undefined') {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const maxDim = 720;
        let width = img.naturalWidth || maxDim;
        let height = img.naturalHeight || maxDim;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const tryEncode = (quality: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file);
                return;
              }
              if (blob.size <= maxBytes || quality <= 0.5) {
                const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
                resolve(new File([blob], compressedName, { type: 'image/jpeg' }));
              } else {
                tryEncode(Math.max(0.5, quality - 0.15));
              }
            },
            'image/jpeg',
            quality
          );
        };
        tryEncode(0.86);
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

export interface CloudinaryUploadResponse {
  success: boolean;
  cloudinary_public_id: string;
  url: string;
  secure_url: string;
  resource_type: string;
  mimeType?: string;
  size?: number;
}

function fileToBase64(fileOrBlob: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || res;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(fileOrBlob);
  });
}

export async function uploadMediaToCloudinary(options: {
  fileOrBlob: File | Blob;
  category: CloudinaryMediaCategory;
  userId: string;
  conversationId?: string;
  messageId?: string;
  fileName?: string;
  mimeType?: string;
}): Promise<CloudinaryUploadResponse> {
  const { fileOrBlob, category, userId, conversationId, messageId, fileName, mimeType } = options;

  // 1. Client-Side Size Validation
  validateClientCloudinaryFileSize(fileOrBlob.size, category);

  // 2. Prepare Base64 Data
  const base64Data = await fileToBase64(fileOrBlob);
  const finalMime = mimeType || fileOrBlob.type || 'application/octet-stream';
  const finalName = fileName || (fileOrBlob as File).name || 'attachment.bin';

  // 3. Send Request to Secure Backend API
  const response = await fetch('/api/cloudinary/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data,
      category,
      userId,
      conversationId,
      messageId,
      mimeType: finalMime,
      fileName: finalName,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    const errMsg = data?.error || CLOUDINARY_CLIENT_ERROR_MESSAGES[category] || 'Media upload failed.';
    throw new Error(errMsg);
  }

  return data as CloudinaryUploadResponse;
}

export async function deleteCloudinaryAsset(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<boolean> {
  if (!publicId) return true;

  try {
    const response = await fetch('/api/cloudinary/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cloudinary_public_id: publicId,
        resource_type: resourceType,
      }),
    });

    const data = await response.json().catch(() => null);
    return Boolean(response.ok && data?.success);
  } catch (err) {
    console.error('Failed to call Cloudinary delete endpoint:', err);
    return false;
  }
}

/**
 * Replace User Profile Picture in Cloudinary
 * Uploads new picture -> updates user profile -> deletes old Cloudinary asset from cloud
 */
export async function replaceProfilePictureInCloudinary(options: {
  file: File;
  userId: string;
  oldCloudinaryPublicId?: string | null;
  onUpdateProfile: (updates: { avatar_url: string; cloudinary_public_id?: string; b2_file_id?: string; b2_file_name?: string }) => Promise<boolean>;
}): Promise<string> {
  const { file, userId, oldCloudinaryPublicId, onUpdateProfile } = options;

  // 1. Validate file size (1 MB max)
  validateClientCloudinaryFileSize(file.size, 'profile');

  // 2. Upload new image to Cloudinary
  const uploadRes = await uploadMediaToCloudinary({
    fileOrBlob: file,
    category: 'profile',
    userId,
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
  });

  if (!uploadRes.url) {
    throw new Error('Failed to get Cloudinary media URL.');
  }

  // 3. Update User Profile
  const updated = await onUpdateProfile({
    avatar_url: uploadRes.url,
    cloudinary_public_id: uploadRes.cloudinary_public_id,
  });

  if (!updated) {
    // Attempt cleanup of newly uploaded image if DB update failed
    try {
      await deleteCloudinaryAsset(uploadRes.cloudinary_public_id, 'image');
    } catch {}
    throw new Error('Failed to update profile record in database.');
  }

  // 4. Delete OLD Profile Picture from Cloudinary
  if (oldCloudinaryPublicId && oldCloudinaryPublicId !== uploadRes.cloudinary_public_id) {
    try {
      await deleteCloudinaryAsset(oldCloudinaryPublicId, 'image');
    } catch (oldDelErr) {
      console.warn('Notice deleting old profile picture from Cloudinary:', oldDelErr);
    }
  }

  return uploadRes.url;
}

/**
 * Remove User Profile Picture from Cloudinary
 */
export async function removeProfilePictureFromCloudinary(options: {
  userId: string;
  cloudinaryPublicId?: string | null;
  onUpdateProfile: (updates: { avatar_url: null; cloudinary_public_id: null }) => Promise<boolean>;
}): Promise<void> {
  const { cloudinaryPublicId, onUpdateProfile } = options;

  if (cloudinaryPublicId) {
    await deleteCloudinaryAsset(cloudinaryPublicId, 'image');
  }

  const updated = await onUpdateProfile({
    avatar_url: null,
    cloudinary_public_id: null,
  });

  if (!updated) {
    throw new Error('Failed to update profile database.');
  }
}
