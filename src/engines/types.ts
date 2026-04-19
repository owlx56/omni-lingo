export interface TranslateRequest {
  text: string;
  source?: string; // BCP-47; 省略即 auto
  target: string;
}

export interface TranslateResponse {
  text: string;
  detectedSource?: string;
  engine: string;
}

export interface Engine {
  id: string;
  translate(req: TranslateRequest): Promise<TranslateResponse>;
}
