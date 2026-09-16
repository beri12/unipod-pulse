import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'unipods:isPublic';

/** Opts a route out of the globally applied JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
