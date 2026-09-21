# Cloudflare でセルフホストする

本番は **Cloudflare Access** で保護する構成です。**利用する認証方法は各自で設定してください。** Google、GitHub、メールのワンタイム PIN、OIDC/SAML など、Access が対応するプロバイダーを選べます。個人用メモアプリとして、1つの許可メールアドレスを設定します。

## 1. 用意するもの

- Cloudflare アカウントと、そのアカウントで管理するドメイン
- Node.js 22 以降、npm
- 利用したい認証プロバイダーのアカウントと、その方式に必要な設定（メールのワンタイム PIN も選択可能）
- R2 が有効な Cloudflare アカウント

費用や利用上限は使用量・契約内容によって変わります。Workers / D1 / KV / R2 / Access の各プランを確認してください。

```sh
git clone https://github.com/daraskme/memos-worker.git
cd memos-worker
npm ci
npx wrangler login
cp wrangler.toml wrangler.production.toml
```

PowerShell: `Copy-Item wrangler.toml wrangler.production.toml`。

以降の本番用コマンドでは必ず `--config wrangler.production.toml` を指定します。このファイルは Git 管理されません。

## 2. Cloudflare リソースを作る

```sh
npx wrangler d1 create memos-db
npx wrangler kv namespace create NOTES_KV
npx wrangler r2 bucket create memos-files
```

既に同名のリソースがある場合は、別名で作成して設定を合わせます。自分のリソースを再利用する場合も内容を確認してください。

`wrangler.production.toml` を編集します。

- `name`: 自分の Worker 名
- `account_id`: 自分の Cloudflare アカウント ID
- `routes`: コメントを外し、`notes.example.com` を使いたいホスト名へ変更
- `[[d1_databases]]`: 作成した `database_id` と `database_name`
- `[[kv_namespaces]]`: 作成した名前空間の `id`
- `[[r2_buckets]]`: 作成した `bucket_name`

バインディング名 `DB`、`NOTES_KV`、`NOTES_R2_BUCKET` は変更しません。
`workers_dev = false`、`preview_urls = false` はそのままにします。

## 3. 任意の認証方法と Access アプリを設定する

1. Cloudflare One の **Integrations → Identity providers** で、利用したい認証プロバイダーを登録します。登録済みのものも再利用できます。外部 IdP を使わない場合はメールのワンタイム PIN を設定します。
2. 選んだ方式の公式手順に従い、必要なクライアント ID・シークレット・コールバック URL などを設定します。OAuth/OIDC の例: `https://your-team.cloudflareaccess.com/cdn-cgi/access/callback`。すべての方式に OAuth 設定が必要なわけではありません。
3. **Access controls → Applications** で Self-hosted アプリを追加し、使いたいホスト名全体を指定します。パスは空欄にします。
4. Allow ポリシーを作り、Include に自分の **メールアドレスの完全一致**を設定します。ログイン方法も制限する場合は Require の **Login Method** に選んだプロバイダーを指定します。
5. アプリで利用可能な IdP に、自分が使う認証方法を選択します。1つだけ利用する場合は、必要に応じて Instant Auth を有効にできます。
6. セッション期間を設定します（この構成では24時間が目安）。HTTP-only Cookie も有効にします。
7. アプリの Additional settings にある **Application Audience (AUD)** を控えます。

本番へコードを配信する前に Access のホスト名とポリシーを設定してください。

クライアントシークレットなどは Cloudflare の IdP 設定に入力し、このリポジトリや Worker のコードには保存しません。アプリはプロバイダー固有の API を使わず、Cloudflare Access が発行する JWT を検証します。選んだ方式で JWT にユーザーの `email` が含まれることを確認してください。

公式手順: [認証プロバイダー一覧と設定](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/) / [Self-hosted Access app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)。

## 4. Worker の認証設定を合わせる

`wrangler.production.toml` の `[vars]` を設定します。

```toml
AUTH_MODE = "cloudflare-access"
CF_ACCESS_TEAM_DOMAIN = "https://your-team.cloudflareaccess.com"
CF_ACCESS_AUD = "YOUR_APPLICATION_AUDIENCE"
CF_ACCESS_EMAIL = "you@example.com"
```

チームドメインは `https://` 付き・末尾スラッシュなしです。メールは Access ポリシーで許可した値と一致させます。選んだ認証方法で Access に渡されるアカウントのメールを指定してください。

設定がない場合や不正な JWT は拒否します。メールヘッダーだけを信頼せず、Access の公開鍵で署名を検証します。
[Cloudflare の JWT 検証ドキュメント](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

## 5. 新規 DB を初期化し、デプロイする

**新規の空 DB にだけ**実行します。

```sh
npx wrangler d1 execute memos-db --remote --config wrangler.production.toml --file src/schema.sql
npm test
npx wrangler versions upload --config wrangler.production.toml --dry-run
npm run deploy
```

DB 名を変えた場合はコマンドの `memos-db` も変更します。既存のメモがある DB に初期化 SQL を実行しないでください。

設定した HTTPS URL にアクセスし、選んだ認証方法でログインします。別のブラウザーやプライベートウィンドウで、未ログイン時に画面と `/api/notes` が Access に転送されることも確認します。

## 6. 既存の上流版から更新する場合

先に D1 と R2 のバックアップを **非公開の場所**に保管します。メモ DB や添付ファイルを公開 GitHub に追加しないでください。

すでに上流版の DB がある場合は、初期化 SQL の代わりに追加マイグレーションを実行します。

```sh
npx wrangler d1 execute memos-db --remote --config wrangler.production.toml --file src/migrations/001_organization.sql
```

このマイグレーションはカテゴリと独立タグの保存テーブルを追加します。既存の本文・添付ファイル・ハッシュタグは維持され、カテゴリ未設定のメモは「未分類」になります。

コード更新:

```sh
git pull
npm ci
npm test
npm run deploy
```

ルート等を変えず、既存 Worker のコードだけを更新する場合:

```sh
npx wrangler versions upload --config wrangler.production.toml --message "Update"
npx wrangler versions deploy VERSION_ID@100% --config wrangler.production.toml --yes
```

`VERSION_ID` は upload が返した値に置き換えます。新しいドメインやルートの初回設定には `npm run deploy` を使用します。

## 認証と共有の範囲

- 本番は単一オーナー向けです。Access ポリシーと `CF_ACCESS_EMAIL` の両方で同じアカウントを許可します。
- ホスト全体を Access で保護するため、上流の「公開共有」リンクもログインが必要です。
- Telegram Webhook など外部サービスからのアクセスも保護対象です。この構成では自動連携の公開エンドポイントを用意していません。
- ローカル専用のパスワード認証は `.dev.vars` で設定します。公開用の `AUTH_MODE` は `cloudflare-access` を維持します。
- GitHub のソースバックアップは D1 / R2 / KV のデータバックアップを含みません。

## API トークンを使う場合

リソース作成・初期化・配信には、対象アカウントの Workers、D1、KV、R2 と対象ゾーンの Workers Routes など、実行する操作に対応する権限が必要です。権限が不足する操作は Cloudflare 管理画面から行うこともできます。

トークン、IdP のクライアントシークレット、ログイン用秘密情報、DB エクスポートはコミットしないでください。

D1 コマンド: [公式ドキュメント](https://developers.cloudflare.com/d1/wrangler-commands/)。
