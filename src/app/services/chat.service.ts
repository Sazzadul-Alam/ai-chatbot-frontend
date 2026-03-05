import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { timeout, tap } from 'rxjs/operators';

const STORAGE_KEY = 'llama_server_props';
const API_HEADERS: Record<string, string> = {
  'x-api-key': 'mylocalminimax123',
};

export interface ServerProps {
  model_alias: string;
  model_path: string;
  total_slots: number;
  default_generation_settings: { n_ctx: number; params: Record<string, any> };
  modalities: { vision: boolean; audio: boolean };
  chat_template: string;
  bos_token: string;
  eos_token: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private apiUrl = 'http://192.168.14.74:8080';
  private props: ServerProps | null = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
  ) {
    this.loadPropsFromStorage();
  }

  private loadPropsFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.props = JSON.parse(raw);
    } catch {}
  }

  fetchAndCacheProps(): Observable<ServerProps> {
    return this.http.get<ServerProps>(`${this.apiUrl}/props`, { headers: API_HEADERS }).pipe(
      tap(props => {
        this.props = props;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(props));
        } catch {}
      }),
    );
  }

  getProps(): ServerProps | null {
    return this.props;
  }

  private buildPayload(messages: { role: string; content: string }[]): Record<string, any> {
    const params = this.props?.default_generation_settings?.params ?? {};
    return {
      messages,
      stream: true,
      return_progress: true,
      temperature: params['temperature'] ?? 0.8,
      dynatemp_range: params['dynatemp_range'] ?? 0,
      dynatemp_exponent: params['dynatemp_exponent'] ?? 1,
      top_k: params['top_k'] ?? 40,
      top_p: params['top_p'] ?? 0.95,
      min_p: params['min_p'] ?? 0.05,
      top_n_sigma: params['top_n_sigma'] ?? -1,
      xtc_probability: params['xtc_probability'] ?? 0,
      xtc_threshold: params['xtc_threshold'] ?? 0.1,
      typical_p: params['typical_p'] ?? 1,
      repeat_last_n: params['repeat_last_n'] ?? 64,
      repeat_penalty: params['repeat_penalty'] ?? 1,
      presence_penalty: params['presence_penalty'] ?? 0,
      frequency_penalty: params['frequency_penalty'] ?? 0,
      dry_multiplier: params['dry_multiplier'] ?? 0,
      dry_base: params['dry_base'] ?? 1.75,
      dry_allowed_length: params['dry_allowed_length'] ?? 2,
      dry_penalty_last_n: params['dry_penalty_last_n'] ?? -1,
      mirostat: params['mirostat'] ?? 0,
      mirostat_tau: params['mirostat_tau'] ?? 5,
      mirostat_eta: params['mirostat_eta'] ?? 0.1,
      max_tokens: params['max_tokens'] ?? -1,
      n_predict: params['n_predict'] ?? -1,
      n_keep: params['n_keep'] ?? 0,
      ignore_eos: params['ignore_eos'] ?? false,
      n_probs: params['n_probs'] ?? 0,
      min_keep: params['min_keep'] ?? 0,
      reasoning_format: params['reasoning_format'] ?? 'none',
      timings_per_token: params['timings_per_token'] ?? false,
      post_sampling_probs: params['post_sampling_probs'] ?? false,
      samplers:
        params['samplers'] ?? ['penalties', 'dry', 'top_n_sigma', 'top_k', 'typ_p', 'top_p', 'min_p', 'xtc', 'temperature'],
    };
  }

  private extractChunkText(payload: any): string {
    return (
      payload?.choices?.[0]?.delta?.content ??
      payload?.choices?.[0]?.delta?.reasoning_content ??
      payload?.choices?.[0]?.message?.content ??
      payload?.choices?.[0]?.text ??
      payload?.content ??
      payload?.token?.text ??
      ''
    );
  }

  private isDone(data: string): boolean {
    return data.trim().toUpperCase() === '[DONE]';
  }

  private hasFinishReason(payload: any): boolean {
    const reason = payload?.choices?.[0]?.finish_reason;
    return reason !== undefined && reason !== null && reason !== '';
  }

  sendMessageStream(
    messages: { role: string; content: string }[],
    onChunk: (accumulated: string) => void,
  ): Observable<string> {
    return new Observable<string>(observer => {
      let accumulated = '';
      let buffer = '';
      let done = false;
      const ctrl = new AbortController();

      const processEventBlock = (block: string): boolean => {
        const lines = block.split(/\r?\n/);
        let eventName = '';
        const dataParts: string[] = [];

        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim().toLowerCase();
            continue;
          }
          if (line.startsWith('data:')) {
            dataParts.push(line.slice(5).trim());
          }
        }

        if (eventName === 'done' || eventName === 'complete' || eventName === 'completed') {
          return true;
        }
        if (!dataParts.length) return false;

        const data = dataParts.join('\n').trim();
        if (!data) return false;
        if (this.isDone(data)) return true;

        try {
          const json = JSON.parse(data);
          const chunk = this.extractChunkText(json);
          if (chunk) {
            accumulated += chunk;
            onChunk(accumulated);
          }
          return this.hasFinishReason(json);
        } catch {
          accumulated += data;
          onChunk(accumulated);
          return false;
        }
      };

      fetch(`${this.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...API_HEADERS,
        },
        body: JSON.stringify(this.buildPayload(messages)),
        signal: ctrl.signal,
      })
        .then(async res => {
          if (!res.ok) {
            observer.error(new Error(`HTTP ${res.status}`));
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            observer.error(new Error('No readable body'));
            return;
          }

          const dec = new TextDecoder();

          const finish = (final: string) => {
            done = true;
            try {
              reader.cancel();
            } catch {}
            ctrl.abort();
            this.zone.run(() => {
              observer.next(final);
              observer.complete();
            });
          };

          try {
            while (true) {
              const { done: streamDone, value } = await reader.read();
              if (streamDone) break;

              buffer += dec.decode(value, { stream: true });
              const events = buffer.split(/\r?\n\r?\n/);
              buffer = events.pop() ?? '';

              for (const eventBlock of events) {
                if (processEventBlock(eventBlock)) {
                  finish(accumulated);
                  return;
                }
              }
            }

            const tail = buffer.trim();
            if (tail && processEventBlock(tail)) {
              finish(accumulated);
              return;
            }

            if (!done) finish(accumulated);
          } catch (error: any) {
            if (!done && error?.name !== 'AbortError') {
              done = true;
              this.zone.run(() => observer.error(error));
            }
          }
        })
        .catch((error: any) => {
          if (!done && error?.name !== 'AbortError') {
            done = true;
            this.zone.run(() => observer.error(error));
          }
        });

      return () => {
        if (!done) {
          done = true;
          ctrl.abort();
        }
      };
    });
  }

  checkHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`, { headers: API_HEADERS }).pipe(timeout(5000));
  }
}
