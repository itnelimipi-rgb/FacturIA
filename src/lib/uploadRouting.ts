export type UploadKind = 'xml' | 'csv' | 'pdf' | 'image' | 'spreadsheet' | 'zip' | 'unsupported';

/** One upload control accepts every supported file; the extension decides how it is read. */
export function classifyUpload(file: Pick<File, 'name' | 'type'>): UploadKind {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'xml') return 'xml';
  if (['csv', 'tsv', 'txt'].includes(extension)) return 'csv';
  if (extension === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image';
  if (['xls', 'xlsx', 'xlsm', 'ods', 'numbers'].includes(extension)) return 'spreadsheet';
  if (['zip', 'rar', '7z'].includes(extension)) return 'zip';
  return 'unsupported';
}

/** XML first so bank rows can be compared with them, then the files that need a review. */
export const uploadOrder: Record<UploadKind, number> = {xml: 0, csv: 1, pdf: 2, image: 2, spreadsheet: 3, zip: 3, unsupported: 3};

export const UPLOAD_ACCEPT = '.xml,.csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.zip';

export function unsupportedUploadMessage(kind: UploadKind): string {
  if (kind === 'spreadsheet') return 'Guárdalo como CSV y súbelo de nuevo. En Excel: Archivo › Guardar como › CSV.';
  if (kind === 'zip') return 'Descomprime el archivo y sube los archivos que contiene.';
  return 'Sube facturas XML, PDF, fotos (JPG, PNG o WebP) o el estado de cuenta en CSV.';
}
