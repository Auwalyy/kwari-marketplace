import multer from 'multer';
import { UPLOAD_LIMITS } from '@kkdm/shared';
import { badRequest } from '../utils/http';

/**
 * Upload middleware keeps files in memory (bounded by size limits) so they can be validated and
 * re-encoded by sharp before anything is written to storage. The declared MIME type is only a first
 * filter; real content validation happens in services/images.ts.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxImageBytes, files: UPLOAD_LIMITS.maxImagesPerProduct, fields: 30, parts: 40 },
  fileFilter: (_req, file, cb) => {
    if (!(UPLOAD_LIMITS.allowedImageMimeTypes as readonly string[]).includes(file.mimetype)) {
      return cb(badRequest('Only JPEG, PNG or WebP images are allowed', 'UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});
