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

    async apagarArquivos(ids) {
      const { error } = await supabase.from('arquivos').delete().in('id', ids);
      if (error) throw new Error(`apagar arquivos: ${error.message}`);
    },

    agora: () => new Date(),
  };
}
