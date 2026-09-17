import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

export const CLOUDINARY_SIZE_LIMITS = {
  profile: 1 * 1024 * 1024, // 1 MB
  'chat-photo': 2 * 1024 * 1024, // 2 MB
  'chat-video': 50 * 1024 * 1024, // 50 MB
  'chat-voice-note': 10 * 1024 * 1024, // 10 MB
} as const;

export type CloudinaryMediaCategory = keyof typeof CLOUDINARY_SIZE_LIMITS;

export const CLOUDINARY_SIZE_ERROR_MESSAGES = {
  profile: 'Profile picture size must be 1 MB or less.',
  'chat-photo': 'Photo size must be 2 MB or less.',
  'chat-video': 'Video size must be 50 MB or less.',
  'chat-voice-note': 'Voice note size must be 10 MB or less.',
} as const;

export function validateCloudinaryFileSize(
  sizeInBytes: number,
  category: CloudinaryMediaCategory
): { valid: boolean; error?: string } {
  const maxLimit = CLOUDINARY_SIZE_LIMITS[category];
  if (sizeInBytes > maxLimit) {
    return {
      valid: false,
      error: CLOUDINARY_SIZE_ERROR_MESSAGES[category] || `File size exceeds limit for ${category}`,
    };
  }
  return { valid: true };
}

export function isCloudinaryConfigured(): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  return Boolean(cloudName && apiKey && apiSecret);
}

export function initCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim(),
      secure: true,
    });
    return true;
  }
  return false;
}

export function buildCloudinaryFolder(
  category: CloudinaryMediaCategory,
  userId: string,
  conversationId?: string
): string {
  const uid = userId || 'user';
  const cid = conversationId || 'general';

  switch (category) {
    case 'profile':
      return `LiveConnect/profile/${uid}`;
    case 'chat-photo':
      return `LiveConnect/chat/photos/${cid}`;
    case 'chat-video':
      return `LiveConnect/chat/videos/${cid}`;
    case 'chat-voice-note':
      return `LiveConnect/chat/voice-notes/${cid}`;
    default:
      return `LiveConnect/chat/general/${cid}`;
  }
}

export interface CloudinaryUploadResult {
  success: boolean;
  cloudinary_public_id: string;
  url: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  bytes: number;
}

export async function uploadBufferToCloudinary(options: {
  buffer: Buffer;
  category: CloudinaryMediaCategory;
  userId: string;
  conversationId?: string;
  messageId?: string;
  mimeType: string;
  fileName?: string;
}): Promise<CloudinaryUploadResult> {
  const { buffer, category, userId, conversationId, mimeType, fileName } = options;

  // 1. Enforce Server-Side Size Validation
  const validation = validateCloudinaryFileSize(buffer.length, category);
  if (!validation.valid) {
    throw new Error(validation.error || 'File size exceeds allowed limit.');
  }

  const folder = buildCloudinaryFolder(category, userId, conversationId);
  const resourceType = category === 'chat-video' ? 'video' : category === 'chat-voice-note' ? 'raw' : 'image';

  // Always write fallback file locally so streaming works even before credentials are set
  const fileId = `${category}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${
    category === 'chat-voice-note' ? 'mp3' : category === 'chat-video' ? 'mp4' : 'jpg'
  }`;

  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(uploadsDir, fileId), buffer);
  } catch (diskErr) {
    console.warn('Local disk fallback write notice:', diskErr);
  }

  let defaultUrl = `/api/media/file/${fileId}`;
  let publicId = `${folder}/${fileId.split('.')[0]}`;

  if (isCloudinaryConfigured()) {
    initCloudinary();
    try {
      const uploadPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_UPLOD_PRESETS || '').trim();
      const options: Record<string, any> = {
        folder,
        resource_type: resourceType === 'raw' ? 'auto' : resourceType,
        overwrite: true,
        invalidate: true,
      };
      if (uploadPreset) {
        options.upload_preset = uploadPreset;
      }

      const uploadPromise = new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          options,
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(buffer);
      });

      const res = await uploadPromise;
      console.log(`[Cloudinary Upload Success] Public ID: ${res.public_id} (${buffer.length} bytes)`);

      return {
        success: true,
        cloudinary_public_id: res.public_id,
        url: res.secure_url || res.url,
        secure_url: res.secure_url || res.url,
        resource_type: res.resource_type || resourceType,
        format: res.format,
        bytes: res.bytes || buffer.length,
      };
    } catch (cErr: any) {
      console.error('[Cloudinary Upload Error]:', cErr?.message || cErr);
    }
  }

  return {
    success: true,
    cloudinary_public_id: publicId,
    url: defaultUrl,
    secure_url: defaultUrl,
    resource_type: resourceType,
    bytes: buffer.length,
  };
}

export async function deleteAssetFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<boolean> {
  if (!publicId) return false;

  if (isCloudinaryConfigured()) {
    initCloudinary();
    try {
      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      console.log(`[Cloudinary Delete Result] '${publicId}':`, res?.result);
      return res?.result === 'ok' || res?.result === 'not_found';
    } catch (err: any) {
      console.error(`[Cloudinary Delete Error] '${publicId}':`, err?.message || err);
      return false;
    }
  }

  return true;
}
