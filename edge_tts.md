# Edge TTS Nedir?

## Kısa Tanım

Edge TTS, **Microsoft'un Edge tarayıcısındaki "Sesli Oku" özelliğinin arkasındaki, bulut tabanlı nöral metin-okuma (text-to-speech) servisidir**. Resmi bir genel API değildir — Microsoft bunu yalnızca kendi tarayıcısı/uygulamaları içinden kullanılmak üzere sunar. `edge-tts` / `edge-tts-universal` gibi açık kaynak kütüphaneler, Edge'in bu servisle konuşurken kullandığı protokolü tersine mühendislikle çözüp herkese açık hale getirir.

Bu projede Edge TTS, **Google Cloud TTS'e ücretsiz, kotasız bir alternatif/yedek** olarak kullanılıyor — Cloud TTS'in Google hesabı, faturalandırma ve günlük kota gereksinimleri var; Edge TTS'in hiçbiri yok.

**İlgili bağlantılar:**
- Kullanılan kütüphane — [edge-tts-universal (npm)](https://www.npmjs.com/package/edge-tts-universal) · [GitHub deposu](https://github.com/travisvn/edge-tts-universal) (`server/package.json`'daki bağımlılık, sürüm `^1.4.0`)
- [Microsoft Edge — "Sesli Oku" (Read Aloud) özelliği](https://support.microsoft.com/en-us/microsoft-edge/hear-text-read-out-loud-with-read-aloud-in-microsoft-edge-1de81b8b-b217-05c5-183c-2c1591f976fa) — bu servisin resmi, kullanıcıya açık yüzü
- [Azure AI Speech (Text to Speech)](https://azure.microsoft.com/en-us/products/ai-services/ai-speech) — Microsoft'un aynı nöral seslere **resmi, ücretli/faturalı** API erişimi sunan kurumsal ürünü; Edge TTS'in "resmi ve garanti edilen" karşılığı budur

## Neden Ayrı Bir Node.js Sunucusu Gerekiyor?

Edge'in TTS backend'i (`speech.platform.bing.com`), bağlantıyı bir WebSocket üzerinden kurarken özel bir header istiyor. Tarayıcıların native `WebSocket` API'si, güvenlik nedeniyle bir web sayfasının bu header'ı elle ayarlamasına **izin vermiyor**. Yani bu proje saf bir tarayıcı uygulaması (PWA) olduğu için, Edge TTS'e **doğrudan** tarayıcıdan bağlanamıyor.

Çözüm: `server/` klasöründeki küçük Express sunucusu, bu WebSocket bağlantısını Node.js tarafında kurup (orada bu kısıtlama yok), sonucu düz bir HTTP endpoint (`POST /synthesize`) üzerinden tarayıcıya döndürüyor.

```
Tarayıcı (src/api/edge-tts.js)
   │  POST /synthesize  { text, voice, rate }
   ▼
Node.js sunucusu (server/index.js)
   │  WebSocket (edge-tts-universal → Communicate)
   ▼
speech.platform.bing.com (Microsoft, resmi olmayan API)
```

## Bu Projede Nerede Kullanılıyor?

| Yer | Dosya | Ne için |
|---|---|---|
| Sunucu endpoint'i | [server/index.js](server/index.js) | `POST /synthesize` — metni alır, `edge-tts-universal`'ın `Communicate` sınıfıyla sese çevirir, MP3 olarak döner |
| İstemci wrapper'ı | [src/api/edge-tts.js](src/api/edge-tts.js) | `/synthesize`'a istek atar, gelen MP3'ü PCM'e çözer |
| Materyal sesi üretimi | [src/api/tts.js](src/api/tts.js) | `generateBothEngines()` — her materyal için Cloud TTS ile **birlikte, bağımsız olarak** Edge TTS de üretir (bkz. aşağıda) |
| Anlık/canlı oynatma | [src/modules/workspace-audio.js](src/modules/workspace-audio.js) | Kelime telaffuzu, Ear Training, Shadowing gibi tek seferlik oynatmalarda **her zaman önce Edge TTS denenir** — Cloud TTS'in günlük kotasını yormamak için |
| Vocab Lesson sesi | [src/modules/workspace-vocab-lesson.js](src/modules/workspace-vocab-lesson.js) | Kelime listesinin sesli anlatımı için önbelleğe alınabilir ses üretimi |

## Çift Motor Yaklaşımı (Cloud + Edge)

Her materyal üretildiğinde artık **iki ayrı ses parçası** oluşturuluyor — biri Google Cloud TTS, biri Edge TTS, **birbirinden bağımsız**:

- Cloud başarısız olsa bile (kota doldu, fatura sorunu vb.) Edge yine de üretilir.
- Edge başarısız olsa bile (Microsoft'un resmi olmayan servisi kesintiye uğrarsa) Cloud yine de üretilir.
- İkisi de başarısız olursa, son çare olarak Gemini TTS devreye girer.

Workspace'teki ses oynatıcıda, birden fazla parça önbellekte varsa küçük bir **geçiş seçici** çıkar — hangi motorun sesini dinleyeceğini yeniden üretmeden anında değiştirebilirsin.

## Güvenilirlik: Bilinmesi Gerekenler

Edge TTS'in **hiçbir SLA'sı (hizmet garantisi) yok** — resmi olmayan, tersine mühendislikle çözülmüş bir API olduğu için:

- Ara sıra **yanıt vermeyebilir / yarım kalabilir** (istek gönderilir ama akış hiç tamamlanmaz).
- Microsoft, kullanım desenini değiştirirse **habersiz bozulabilir**.
- Kişisel/eğitim amaçlı kullanım için uygundur; ticari kullanım için değildir (kod içindeki yorumda da belirtilmiş).

Bu yüzden hem istemci hem sunucu tarafında **zaman aşımı (timeout)** koruması var:

- İstemci ([edge-tts.js](src/api/edge-tts.js)): 30 saniye içinde yanıt gelmezse istek iptal edilir, net bir hata mesajı gösterilir.
- Sunucu ([server/index.js](server/index.js)): Microsoft'a giden bağlantı 25 saniyede tamamlanmazsa sunucu da isteği düşürür — böylece sunucu tarafında da sonsuza kadar açık kalan bir bağlantı olmaz.

Bu korumalar eklenmeden önce, Edge TTS'in tek bir isteği (nadiren de olsa) **dakikalarca askıda kalabiliyor**, bu da tüm ses üretim akışını (Cloud/Edge/Gemini sırasıyla denenen zincir) kilitleyebiliyordu — artık en fazla ~25-30 saniye içinde başarısız olup bir sonraki motora/hataya geçiyor.

## Sorun Giderme

| Belirti | Muhtemel sebep | Çözüm |
|---|---|---|
| "Edge TTS server is not reachable — is it running?" | `server/` klasöründeki Node süreci çalışmıyor | Yerelde: `npm run edge-tts-server` (veya `npm run dev:all`). VDS'te: `systemctl status generallisteningwithsubject.service` |
| "Edge TTS timed out after 30s" | Microsoft'un servisi yanıt vermiyor/takıldı | Genelde geçicidir, tekrar dene. Sık tekrarlıyorsa Cloud TTS'e geç |
| Ses hiç üretilmiyor, sessiz kalıyor | `voice` parametresi geçersiz | [EDGE_TTS_VOICES](src/api/edge-tts.js) listesindeki seslerden birini kullandığından emin ol |
| VDS'te 413 (Payload Too Large) | nginx'in yükleme limiti | `client_max_body_size` nginx config'inde yeterince büyük olmalı (bu projede 60m ayarlı) |

## Kullanılabilir Sesler

`src/api/edge-tts.js` içinde tanımlı:

- `en-US-AndrewNeural` (varsayılan)
- `en-US-GuyNeural`
- `en-US-AriaNeural`
- `en-US-JennyNeural`
- `en-GB-SoniaNeural`

Microsoft'un tam ses listesi çok daha geniştir (farklı diller/aksanlar dahil); bu proje sadece İngilizce öğrenimine uygun birkaçını seçip kullanıyor.
