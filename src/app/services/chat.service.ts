import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { timeout, tap } from 'rxjs/operators';

const STORAGE_KEY = 'llama_server_props';
const API_HEADERS = {
  'x-api-key': 'mylocalminimax123'
};

export interface ServerProps {
  model_alias:    string;
  model_path:     string;
  total_slots:    number;
  default_generation_settings: {
    n_ctx: number;
    params: Record<string, any>;
  };
  modalities:     { vision: boolean; audio: boolean };
  chat_template:  string;
  bos_token:      string;
  eos_token:      string;
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
    } catch { /* ignore */ }
  }

  fetchAndCacheProps(): Observable<ServerProps> {
    return this.http.get<ServerProps>(`${this.apiUrl}/props`, {
      headers: API_HEADERS
    }).pipe(
      tap(props => {
        this.props = props;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(props));
        } catch { /* ignore quota errors */ }
      })
    );
  }

  getProps(): ServerProps | null {
    return this.props;
  }

  private buildPayload(messages: { role: string; content: string }[]): Record<string, any> {
    const p = this.props?.default_generation_settings?.params ?? {};

    return {
      messages,
      stream:               true,
      return_progress:      true,
      temperature:          p['temperature']          ?? 0.8,
      dynatemp_range:       p['dynatemp_range']        ?? 0,
      dynatemp_exponent:    p['dynatemp_exponent']     ?? 1,
      top_k:                p['top_k']                 ?? 40,
      top_p:                p['top_p']                 ?? 0.95,
      min_p:                p['min_p']                 ?? 0.05,
      top_n_sigma:          p['top_n_sigma']           ?? -1,
      xtc_probability:      p['xtc_probability']       ?? 0,
      xtc_threshold:        p['xtc_threshold']         ?? 0.1,
      typical_p:            p['typical_p']             ?? 1,
      repeat_last_n:        p['repeat_last_n']         ?? 64,
      repeat_penalty:       p['repeat_penalty']        ?? 1,
      presence_penalty:     p['presence_penalty']      ?? 0,
      frequency_penalty:    p['frequency_penalty']     ?? 0,
      dry_multiplier:       p['dry_multiplier']        ?? 0,
      dry_base:             p['dry_base']              ?? 1.75,
      dry_allowed_length:   p['dry_allowed_length']    ?? 2,
      dry_penalty_last_n:   p['dry_penalty_last_n']    ?? -1,
      mirostat:             p['mirostat']              ?? 0,
      mirostat_tau:         p['mirostat_tau']          ?? 5,
      mirostat_eta:         p['mirostat_eta']          ?? 0.1,
      max_tokens:           p['max_tokens']            ?? -1,
      n_predict:            p['n_predict']             ?? -1,
      n_keep:               p['n_keep']                ?? 0,
      ignore_eos:           p['ignore_eos']            ?? false,
      n_probs:              p['n_probs']               ?? 0,
      min_keep:             p['min_keep']              ?? 0,
      reasoning_format:     p['reasoning_format']      ?? 'none',
      timings_per_token:    p['timings_per_token']     ?? false,
      post_sampling_probs:  p['post_sampling_probs']   ?? false,
      samplers:             p['samplers']              ?? [
        'penalties', 'dry', 'top_n_sigma', 'top_k', 'typ_p', 'top_p', 'min_p', 'xtc', 'temperature'
      ],
    };
  }

  sendMessageStream(
    messages: { role: string; content: string }[]
  ): Observable<string> {
    return new Observable(observer => {
      const controller  = new AbortController();
      const hardTimeout = setTimeout(() => controller.abort(), 86_400_000);

      let buffer      = '';
      let accumulated = '';

      const cleanup = () => clearTimeout(hardTimeout);

      const body = this.buildPayload(messages);

      this.zone.runOutsideAngular(() => {
        fetch(`${this.apiUrl}/v1/chat/completions`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Accept':        'text/event-stream',
            'Cache-Control': 'no-cache',
            'Pragma':        'no-cache',
            ...API_HEADERS,
          },
          body:   JSON.stringify(body),
          signal: controller.signal,
        })
          .then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No readable body');
            const decoder = new TextDecoder();

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const raw of lines) {
                  const line = raw.trim();
                  if (!line || line.startsWith(':')) continue;

                  if (line.startsWith('data:')) {
                    const data = line.slice(5).trim();

                    if (data === '[DONE]') {
                      cleanup();
                      this.zone.run(() => {
                        observer.next(accumulated);
                        observer.complete();
                      });
                      return;
                    }

                    try {
                      const json  = JSON.parse(data);
                      const chunk = json?.choices?.[0]?.delta?.content;
                      if (chunk) {
                        accumulated += chunk;
                        const snapshot = accumulated;
                        this.zone.run(() => observer.next(snapshot));
                      }
                    } catch { /* ignore partial JSON */ }
                  }
                }
              }

              // Stream ended without [DONE]
              cleanup();
              this.zone.run(() => {
                observer.next(accumulated);
                observer.complete();
              });

            } catch (e) {
              cleanup();
              this.zone.run(() => observer.error(e));
            }
          })
          .catch(err => {
            cleanup();
            this.zone.run(() => observer.error(err));
          });
      });

      return () => {
        cleanup();
        controller.abort();
      };
    });
  }

  checkHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`, {
      headers: API_HEADERS
    }).pipe(timeout(5000));
  }
}
