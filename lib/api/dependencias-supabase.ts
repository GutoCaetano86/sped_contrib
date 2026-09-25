// Implementacao de `Dependencias` sobre o Supabase.
//
// Unico modulo de lib/api/ que importa Supabase; os handlers nao o conhecem.
// Usa `criarClienteServidor()`, que respeita a RLS — a RLS continua sendo a
// camada de isolamento (F3-T1), e as checagens de dono nos handlers sao a
// segunda camada.
import { criarClienteServidor } from '@/lib/supabase/server';
import { PLANO_PADRAO } from '@/lib/plans';
import type {
  Bucket,
  Dependencias,
  NovoArquivo,
  RegistroArquivo,
  RegistroConversao,
} from './dependencias';

/** Erro de infraestrutura; vira 500 no handler, com a causa no log do servidor. */
class ErroSupabase extends Error {
  constructor(operacao: string, causa: unknown) {
    const detalhe =
      causa && typeof causa === 'object' && 'message' in causa
        ? String((causa as { message: unknown }).message)
        : String(causa);
    super(`${operacao}: ${detalhe}`);
    this.name = 'ErroSupabase';
  }
}

export async function dependenciasSupabase(): Promise<Dependencias> {
  const supabase = await criarClienteServidor();

  return {
    async usuario() {
      // getUser() valida o token no servidor; getSession() so le o cookie.
      const { data } = await supabase.auth.getUser();
      return data.user ? { id: data.user.id } : null;
    },

    async plano(userId) {
      const { data, error } = await supabase
        .from('perfis')
        .select('plano')
        .eq('id', userId)
        .maybeSingle();
      // Perfil ausente nao pode liberar limite alto: cai no plano padrao, que
      // e o mais restritivo.
      if (error || !data) return PLANO_PADRAO;
      return String(data.plano);
    },

    async contarConversoes(userId, desde) {
      const { count, error } = await supabase
        .from('conversoes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('criado_em', desde.toISOString());
      if (error) throw new ErroSupabase('contar conversoes', error);
      return count ?? 0;
    },

    async inserirArquivo(dados: NovoArquivo) {
      const { data, error } = await supabase
        .from('arquivos')
        .insert(dados)
        .select('*')
        .single();
      if (error || !data) throw new ErroSupabase('inserir arquivo', error);
      return data as RegistroArquivo;
    },

    async obterArquivo(id) {
      const { data, error } = await supabase
        .from('arquivos')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      // A RLS faz esta consulta devolver vazio para arquivo de outro usuario;
      // o handler ainda compara o user_id, como segunda camada.
      if (error) return null;
      return (data as RegistroArquivo | null) ?? null;
    },

    async listarArquivos(userId, inicio, quantidade) {
      const { data, error, count } = await supabase
        .from('arquivos')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('criado_em', { ascending: false })
        .range(inicio, inicio + quantidade - 1);
      if (error) throw new ErroSupabase('listar arquivos', error);
      return { itens: (data ?? []) as RegistroArquivo[], total: count ?? 0 };
    },

    async apagarArquivo(id) {
      const { error } = await supabase.from('arquivos').delete().eq('id', id);
      if (error) throw new ErroSupabase('apagar arquivo', error);
    },

    async remover(bucket: Bucket, caminho) {
      const { error } = await supabase.storage.from(bucket).remove([caminho]);
      // Objeto ausente nao e erro: o alvo e ele nao existir.
      if (error) throw new ErroSupabase(`remover de ${bucket}`, error);
    },

    async conversoesDoArquivo(userId, arquivoId) {
      const { data, error } = await supabase
        .from('conversoes')
        .select('*')
        .eq('user_id', userId)
        .or(`arquivo_origem_id.eq.${arquivoId},arquivo_saida_id.eq.${arquivoId}`)
        .order('criado_em', { ascending: false });
      if (error) throw new ErroSupabase('conversoes do arquivo', error);
      return (data ?? []) as RegistroConversao[];
    },

    async conversoesDeArquivos(userId, arquivoIds) {
      if (arquivoIds.length === 0) return [];
      const { data, error } = await supabase
        .from('conversoes')
        .select('*')
        .eq('user_id', userId)
        // Origem OU saida: um arquivo gerado por conversao precisa ser
        // reconhecido como resultado, senao a lista o mostra como pendente.
        .or(
          `arquivo_origem_id.in.(${arquivoIds.join(',')}),` +
            `arquivo_saida_id.in.(${arquivoIds.join(',')})`,
        )
        .order('criado_em', { ascending: false });
      if (error) throw new ErroSupabase('listar conversoes', error);
      return (data ?? []) as RegistroConversao[];
    },

    async criarConversao(dados) {
      const { data, error } = await supabase
        .from('conversoes')
        .insert(dados)
        .select('*')
        .single();
      if (error || !data) throw new ErroSupabase('criar conversao', error);
      return data as RegistroConversao;
    },

    async atualizarConversao(id, dados) {
      const { error } = await supabase.from('conversoes').update(dados).eq('id', id);
      if (error) throw new ErroSupabase('atualizar conversao', error);
    },

    async subir(bucket: Bucket, caminho, bytes, contentType) {
      const { error } = await supabase.storage.from(bucket).upload(caminho, bytes, {
        contentType,
        // Caminho leva uuid novo a cada upload; sobrescrever seria sinal de bug.
        upsert: false,
      });
      if (error) throw new ErroSupabase(`subir para ${bucket}`, error);
    },

    async baixar(bucket: Bucket, caminho) {
      const { data, error } = await supabase.storage.from(bucket).download(caminho);
      if (error || !data) throw new ErroSupabase(`baixar de ${bucket}`, error);
      return Buffer.from(await data.arrayBuffer());
    },

    async urlAssinada(bucket: Bucket, caminho, segundos, nomeParaDownload) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(
          caminho,
          segundos,
          nomeParaDownload ? { download: nomeParaDownload } : undefined,
        );
      if (error || !data) throw new ErroSupabase(`assinar url em ${bucket}`, error);
      return data.signedUrl;
    },

    novoId: () => crypto.randomUUID(),
    agora: () => new Date(),
  };
}
