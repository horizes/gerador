# Instalação do aplicativo após o cadastro

Após confirmar o e-mail e salvar a primeira senha, a pessoa recebe a tela **Cadastro concluído → Instale o aplicativo**. Ela pode instalar ou escolher **Continuar no navegador** para acessar suas ferramentas.

O botão abre a confirmação de instalação quando o navegador fornece essa opção. Caso contrário, oferece instruções próprias para Android, iPhone/iPad, computador e Safari no Mac. Ao abrir as instruções, o botão dá lugar ao passo a passo. A instalação continua disponível no menu da plataforma.

O cadastro já está concluído nessa tela. Recarregar a aba retoma a opção de instalação; continuar libera a plataforma e encerra essa etapa. A recuperação de uma senha existente e os logins seguintes não exibem essa tela automaticamente. Se a plataforma já estiver aberta como aplicativo, a tela permite entrar diretamente.

## Atualizar a versão já corrigida

Extraia `imperium-plataforma-com-instalacao.zip` e substitua estes cinco arquivos na pasta publicada do site, mantendo os caminhos:

- `index.html`
- `js/auth.js`
- `js/pwa.js`
- `css/auth.css`
- `sw.js`

Esta adição não exige alteração no Supabase. Se ainda não aplicou a correção do código por e-mail, o ZIP também contém essa correção e seu guia `CORRECAO-CODIGO-EMAIL.md`.

Mantenha `manifest.json`, os ícones em `assets/icons` e os demais arquivos existentes. A plataforma já usa o formato de aplicativo web instalável; não é necessário distribuir APK ou instalador para Windows.

Aguarde a publicação e abra o site com internet. As versões novas são `auth.js?v=15`, `pwa.js?v=2`, `auth.css?v=8` e cache `imperium-v43`.

## Conferir a instalação publicada

1. Abra a plataforma por HTTPS e complete um convite de teste, confirmando o e-mail e criando a senha.
2. Confira a tela de instalação antes da abertura das ferramentas.
3. No Chrome ou Edge, quando o navegador disponibilizar a instalação direta, toque em **Instalar aplicativo** e confirme na janela nativa.
4. No iPhone/iPad, veja as instruções e abra a plataforma no Safari. Use **Compartilhar → Adicionar à Tela de Início**; mantenha a opção de abrir como aplicativo ativada quando aparecer.
5. Abra a Imperium pelo ícone criado. Se esse ambiente não compartilhar a sessão do navegador, entre com o e-mail e a senha que acabou de criar.
6. Confira também **Continuar no navegador** e o botão **Instalar aplicativo** do menu. Cancelar a instalação deve permitir continuar normalmente.

A confirmação direta depende do suporte e dos critérios do navegador. O site não instala o aplicativo sem a escolha da pessoa. Quando o pedido nativo ainda não estiver disponível, a tela mostra como instalar pelo próprio navegador.

## Validação

Passaram 33 testes locais do cadastro e da instalação. Eles verificam a primeira senha, retomada após recarregar, recuperação, instruções por dispositivo, convite nativo que chega depois da tela, cancelamento, falha de instalação e reabertura pelo menu.

Também foi conferido o HTML real no Chrome com tamanhos de computador e celular e identificação de Android/iPhone. As chamadas ao Supabase e os eventos nativos de instalação foram simulados. Não foi instalado um aplicativo real nos aparelhos nem alterada a publicação de produção durante a preparação.

Para executar os testes com Node.js:

```powershell
node --test tests/auth-flow.test.cjs tests/pwa-install.test.cjs
```

Referências oficiais: [instalação e confirmação nativa](https://web.dev/learn/pwa/installation-prompt), [aplicativos web no Chrome](https://support.google.com/chrome/answer/9658361), [adicionar à Tela de Início no iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [aplicativos web no Safari do Mac](https://support.apple.com/en-gb/104996).
