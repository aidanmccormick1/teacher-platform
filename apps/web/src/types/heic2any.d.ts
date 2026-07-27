declare module 'heic2any' {
  type HeicConversionOptions = {
    blob: Blob;
    toType?: string;
    quality?: number;
  };

  export default function heic2any(options: HeicConversionOptions): Promise<Blob | Blob[]>;
}
