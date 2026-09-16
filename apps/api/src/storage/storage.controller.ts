import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { Public } from '../common/decorators/public.decorator';
import { AppException, ERROR_CODES } from '../common/errors';
import { StorageService } from './storage.service';

/**
 * Serves objects held by the local storage driver.
 *
 * The route is public but every request must carry a valid, unexpired HMAC
 * signature issued by `StorageService.signedUrl`, so an unauthenticated caller
 * cannot guess its way to community files. With the S3 driver this route is
 * unused — signed URLs point straight at the bucket.
 */
@ApiExcludeController()
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('*key')
  download(
    @Param('key') key: string | string[],
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): void {
    // Express 5 hands a wildcard parameter back as the path's segments.
    const raw = Array.isArray(key) ? key.join('/') : key;
    const decodedKey = decodeURIComponent(raw);
    const valid = this.storage.verifyLocalSignature(
      decodedKey,
      Number.parseInt(expires ?? '', 10),
      signature ?? '',
    );
    if (!valid) {
      throw new AppException(
        ERROR_CODES.FORBIDDEN,
        'This download link is invalid or has expired.',
        403,
      );
    }
    const path = this.storage.localPath(decodedKey);
    if (!path) {
      throw AppException.notFound('The file');
    }
    createReadStream(path)
      .on('error', () => {
        if (!response.headersSent) response.status(404).end();
      })
      .pipe(response);
  }
}
