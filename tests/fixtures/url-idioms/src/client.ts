import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

function buildUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export const viaReplaceIdiom = () => fetch(`${API}/health`);
export const viaBuildUrl = () => fetch(buildUrl(API, '/health'));
export const trailingQueryParam = (query = '') => fetch(`${API}/video-assets${query}`);
export const trailingQueryOnSegment = (qs?: string) => fetch(`${API}/video-assets/stats${qs ? `?${qs}` : ''}`);
export const realParamSegment = (id: string) => fetch(`${API}/video-assets/${id}`);

@Injectable()
export class CommentsClient {
  constructor(private readonly configService: ConfigService) {}
  remove(id: string) {
    return axios.delete(`${this.configService.get<string>('SSO_URL')}/api/internal/comments/${id}`);
  }
}

class NotAConfigService {
  get(key: string) { return process.argv[key.length]; }
}
export const lookalike = (c: NotAConfigService) => fetch(`${c.get('SSO_URL')}/health`);
