// Cliente Supabase para componentes de browser.
import { createBrowserClient } from '@supabase/ssr';
import { CHAVE_PUBLICAVEL, URL_SUPABASE } from './config';

export function criarClienteBrowser() {
  return createBrowserClient(URL_SUPABASE(), CHAVE_PUBLICAVEL());
}
