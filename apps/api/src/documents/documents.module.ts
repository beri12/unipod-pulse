import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { loadEnv } from '@unipods/config';
import { memoryStorage } from 'multer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    // Files are held in memory only long enough to validate and forward them to
    // object storage; nothing lands on the API container's disk.
    MulterModule.registerAsync({
      useFactory: () => ({
        storage: memoryStorage(),
        limits: { fileSize: loadEnv().MAX_FILE_SIZE, files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
