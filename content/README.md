# İçerik Klasörü (`content/`)

Bu klasör, uygulama dışında (Generator'daki "Show Gemini Prompt" ile alınan
prompt'u elle kopyalayıp istediğin bir LLM'e yapıştırarak) önceden üretilmiş
materyalleri tutar. `scripts/import-content.mjs` bu klasörü tarayıp
materyalleri kütüphaneye ekler/günceller.

## Klasör/dosya kuralı

```
content/{konu-slug}/{alt-konu-slug}/{seviye}-{mode}.json
```

- **konu-slug / alt-konu-slug**: küçük harf, kelimeler arasında tire (`-`).
  Örn: `climate-change`, `global-warming-causes`. Import sırasında bu
  slug'lar başlık formatına çevrilir (`climate-change` → `Climate Change`),
  o yüzden anlamlı/düzgün yaz.
- **seviye**: `a1plus`, `a2`, `b1`, `b2`, `c1`, `c2` (küçük harf, `+` yerine `plus`).
- **mode**: uygulamadaki mode key'leriyle birebir aynı olmalı —
  `selective` (Selective Listening), `careful` (Careful Listening),
  `search-reading` (Search Reading), `careful-reading` (Careful Reading).
  (`src/modules/material-modes.js`)

Örnek: `content/climate-change/global-warming-causes/b1-selective.json`

## Dosya içeriği

Gemini'ye (veya başka bir LLM'e) gönderilen prompt'un döndürdüğü **ham
JSON'un aynısı** — `title`, `transcript`, `paragraphs`, `questions`,
`vocabulary`, `expressions`, `grammar`, `shadowing` alanlarını içerir.
Konu/alt-konu/seviye/mode'u JSON'un İÇİNE yazmana gerek yok — bunlar dosya
yolundan otomatik çıkarılıyor.

## Import etmek

```bash
node scripts/import-content.mjs
```

Varsayılan olarak `http://localhost:5175`'e karşı çalışır (yerel geliştirme
sunucusu). VDS'teki canlı siteye import etmek için:

```bash
API_URL=http://185.149.103.172 API_TOKEN=<token> node scripts/import-content.mjs
```

Script **idempotent** — aynı dosyayı tekrar import edersen (örn. içeriği
düzenledikten sonra) yeni bir kopya oluşturmaz, mevcut materyali günceller
(dosya yoluna göre eşleştirir). Ses üretimi bu script'e dahil değil —
materyal içe aktarıldıktan sonra Workspace'te "Generate Speech" butonuyla
(Cloud + Edge, ikisi birden) manuel üretilir.
