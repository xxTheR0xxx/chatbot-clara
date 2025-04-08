
// (inicio do código permanece igual...)

      // 3. Atualizar OU Inserir dados no Supabase
      const atualizacao = {};
      if (extraido.nome) atualizacao.nome = extraido.nome;
      if (extraido.cpf) atualizacao.cpf = extraido.cpf;
      if (extraido.rg) atualizacao.rg = extraido.rg;
      if (extraido.email) atualizacao.email = extraido.email;
      if (extraido.endereco) atualizacao.endereco = extraido.endereco;
      if (extraido.telefone) atualizacao.telefone_alternativo = extraido.telefone;

      if (Object.keys(atualizacao).length > 0) {
        // Verifica se o número já existe
        const { data: existente, error: erroBuscaContato } = await supabase
          .from('Contatos')
          .select('id')
          .eq('numero_whatsapp', numeroLimpo)
          .maybeSingle();

        if (erroBuscaContato && erroBuscaContato.code !== 'PGRST116') {
          console.error('Erro ao buscar contato:', erroBuscaContato.message);
        } else if (existente) {
          // Atualiza se já existir
          const { error: erroAtualizacao } = await supabase
            .from('Contatos')
            .update(atualizacao)
            .eq('numero_whatsapp', numeroLimpo);

          if (erroAtualizacao) {
            console.error('Erro ao atualizar contato:', erroAtualizacao.message);
          } else {
            console.log(`🧠 Dados atualizados no Supabase para ${numeroLimpo}:`, atualizacao);
          }
        } else {
          // Insere se não existir
          const { error: erroInsercao } = await supabase
            .from('Contatos')
            .insert([{ numero_whatsapp: numeroLimpo, ...atualizacao }]);

          if (erroInsercao) {
            console.error('Erro ao inserir novo contato:', erroInsercao.message);
          } else {
            console.log(`🆕 Novo contato inserido no Supabase para ${numeroLimpo}:`, atualizacao);
          }
        }
      }

// (restante do código continua igual...)
