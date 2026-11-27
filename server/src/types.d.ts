declare module 'qrcode' {
  interface Options { type?: 'terminal' | 'svg' | 'utf8'; small?: boolean; margin?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }
  const QRCode: { toString(text: string, options?: Options): Promise<string> };
  export default QRCode;
}
