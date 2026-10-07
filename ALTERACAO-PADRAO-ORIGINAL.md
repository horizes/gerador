# Restaurar padrão original

O gerador de propostas agora tem os botões **Salvar preferências** e **Restaurar padrão**, com explicações curtas.

Após a confirmação, o padrão personalizado é removido da conta. Valores, benefícios, seções, diferenciais, fidelidade, assinatura e imagens de parceiros voltam às configurações originais. Cargos personalizados e seleções da contratação são limpos. Os dados do cliente atual, a foto da capa, o escopo, as observações, a data e o nome do arquivo são mantidos.

As novas propostas usam o padrão original, inclusive em outros aparelhos. Depois disso, é possível salvar novas preferências normalmente. Em caso de falha de conexão, as preferências e a proposta atual são preservadas.

Publique a pasta `imperium-plataforma` deste ZIP na hospedagem existente. O ajuste utiliza a permissão de exclusão já prevista em `supabase-schema-propostas-padrao.sql`; não exige alteração no banco de dados.
