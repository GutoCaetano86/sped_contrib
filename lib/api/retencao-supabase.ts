// Implementacao de `DependenciasRetencao` com service role.
//
// Precisa ignorar a RLS de proposito: o job varre TODOS os usuarios, e a RLS
// so enxerga o dono da sessao — aqui nao ha sessao. E o unico lugar do projeto
// que usa `criarClienteAdmin()`.
import { criarClienteAdmin } from '@/lib/supabase/admin';
import type { Bucket } from './dependencias';
import type { ArquivoVencido, DependenciasRetencao } from './retencao';

export function dependenciasRetencao(): DependenciasRetencao {
  const supabase = criarClienteAdmin();

  return {
    async planosDosUsuarios() {
      const { data, error } = await supabase.from('perfis').select('id, plano');
      if (error) throw new Error(`ler perfis: ${error.message}`);
      return (data ?? []) as { id: string; plano: string }[];
    },

    async arquivosAte(userId, limite) {
      const { data, error } = await supabase
        .from('arquivos')
        .select('id, storage_path, user_id')
        .eq('user_id', userId)
        .lt('criado_em', limite.toISOString());
      if (error) throw new Error(`listar vencidos: ${error.message}`);
      return (data ?? []) as ArquivoVencido[];
    },

    async removerObjetos(bucket: Bucket, caminhos) {
      const { error } = await supabase.storage.from(bucket).remove(caminhos);
      if (error) throw new Error(`remover de ${bucket}: ${error.message}`);
    },

    async listarObjetos(bucket: Bucket, prefixo) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(prefixo, { limit: 1000 });
      if (error) throw new Error(`listar objetos de ${bucket}: ${error.message}`);
      return (data ?? []).map((o) => ({
        nome: o.name,
        criadoEm: o.created_at ?? new Date(0).toISOString(),
      }));
    },

    async caminhosRegistrados(userId) {
      const { data, error } = await supabase
        .from('arquivos')
        .select('storage_path')
        .eq('user_id', userId);
      if (error) throw new Error(`caminhos registrados: ${error.message}`);
      return (data ?? []).map((a) => String((a as { storage_path: string }).storage_path));
    },

    async apagarArquivos(ids) {
      const { error } = await supabase.from('arquivos').delete().in('id', ids);
      if (error) throw new Error(`apagar arquivos: ${error.message}`);
    },

    agora: () => new Date(),
  };
}
