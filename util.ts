export type UnifiedFetcher = (url: string) => Promise<UnifiedResponse>;
export type UnifiedMultiFetcher = (url: string[]) => Promise<UnifiedResponse[]>;

export interface UnifiedResponse {
  text: () => Promise<string>;
}

export async function multiFetch(urls: string[]): Promise<UnifiedResponse[]> {
  return Promise.all(urls.map((url) => fetch(url)));
}
