# IndexedDB Nedir?

## Kısa Tanım

IndexedDB, **tarayıcıların içine gömülü, düşük seviyeli bir veritabanı sistemidir**. Web sayfalarının/uygulamaların, kullanıcının bilgisayarında (sunucuya hiç gitmeden) büyük miktarda yapılandırılmış veriyi kalıcı olarak saklamasını sağlar. Chrome, Edge, Firefox, Safari dahil tüm modern tarayıcılarda bulunur; W3C/WHATWG standardıdır.

Bu projede (Academic English Studio) tüm materyaller, sorular, ses dosyaları vb. IndexedDB'de saklanıyor — sunucu yok, backend yok, her şey senin tarayıcında.

## localStorage ile Farkı

Web'de veri saklamanın birkaç yolu var; en çok karıştırılan ikisi:

| Özellik | localStorage | IndexedDB |
|---|---|---|
| Veri tipi | Sadece string (key-value) | Herhangi bir JS objesi, Blob, dosya |
| Boyut limiti | ~5-10 MB | Yüzlerce MB - GB'lar (diskte yer varsa) |
| API | Senkron (bloklayıcı) | Asenkron (bloklamaz) |
| Sorgulama | Yok, sadece key ile erişim | Index'ler, aralık sorguları, cursor |
| İşlem (transaction) | Yok | Var, atomik okuma/yazma |
| Binary veri (ses, resim) | Desteklemez (encode gerekir) | Doğrudan destekler (Blob/ArrayBuffer) |

Bu yüzden bu projede ses dosyaları (Blob) IndexedDB'de tutuluyor — localStorage'a bir ses dosyası koymak pratik değil (boyut limiti ve string'e çevirme zorunluluğu yüzünden).

## Temel Kavramlar

- **Database**: En üst kapsayıcı. Bir origin (`http://localhost:5173` gibi) birden fazla database'e sahip olabilir. Bu projede database adı `AcademicEnglishStudio`.
- **Object Store**: SQL'deki "tablo" karşılığı. Bu projede `materials`, `folders`, `tags`, `audioCache`, `settings`, `studyLog` gibi store'lar var.
- **Key**: Her kaydın benzersiz kimliği (örn. `materials` store'unda otomatik artan `id`).
- **Index**: Belirli bir alana göre hızlı arama/sıralama yapabilmek için oluşturulan ikincil anahtar (örn. `lastStudiedAt`'a göre sıralama).
- **Transaction**: Bir veya birden fazla store üzerinde yapılan okuma/yazma işlemlerinin atomik (ya hep ya hiç) grubu.
- **Cursor**: Büyük veri kümelerinde kayıt kayıt gezinmeyi sağlayan mekanizma.

## Nasıl Çalışır (Genel Akış)

1. Tarayıcı, her web sitesi/origin için **ayrı ve izole** bir IndexedDB alanı tutar (Chrome bir sitenin verisine, başka bir sitenin JavaScript'i erişemez — güvenlik sınırı budur).
2. Veritabanı açılır (`indexedDB.open(name, version)`), yoksa oluşturulur.
3. Şema (hangi store'lar, hangi index'ler olacağı) sadece **versiyon yükseltmesi** sırasında değiştirilebilir (`onupgradeneeded` event'i).
4. Tüm okuma/yazma işlemleri **asenkron**dur — sayfayı dondurmaz, `Promise`/`callback` ile sonuç döner.
5. Veri, tarayıcı kapansa, bilgisayar yeniden başlasa bile **diskte kalıcı olarak durur** — ta ki kullanıcı "tarama verilerini temizle" yapana ya da kod açıkça silene kadar.

## Ham API mi, Yoksa Kütüphane mi?

IndexedDB'nin **çıplak/native JavaScript API'si oldukça hantaldır** — event-tabanlıdır, `Promise` desteği yoktur, çok satırlık boilerplate gerektirir. Bu yüzden neredeyse hiç kimse ham API ile çalışmaz; bunun yerine bir sarmalayıcı (wrapper) kütüphane kullanılır.

Bu projede **[Dexie.js](https://dexie.org/)** kullanılıyor — IndexedDB'yi modern, `async/await` uyumlu, SQL benzeri basit bir arayüze çeviren popüler bir kütüphane. Projede şema tanımı [src/db.js](src/db.js) dosyasında:

```js
const db = new Dexie('AcademicEnglishStudio')
db.version(1).stores({
  materials: '++id, title, topic, level, mode, createdAt, ...',
  audioCache: 'materialId, blob, createdAt',
  // ...
})
```

Dexie olmasaydı aynı işlemi yapmak için onlarca satır ham `indexedDB.open()`, `onupgradeneeded`, `transaction`, `objectStore` kodu yazmak gerekirdi.

## Limitler ve Sınırlamalar

- **Kota**: Tarayıcıya ve boş disk alanına göre değişir; genelde diskin %50-60'ına kadar (çoğu kullanım için pratikte "sınırsız" gibi düşünülebilir).
- **Origin bazlı izolasyon**: `localhost:5173` ile `localhost:3000` bile tarayıcı için **farklı origin**dir, farklı IndexedDB alanı demektir.
- **Gizli/InPrivate mod**: Pencere kapanınca tüm veri silinir.
- **Kullanıcı temizlerse**: "Clear browsing data" / "Tarama verilerini temizle" yaparsa (site verileri dahil), IndexedDB de silinir — bu yüzden önemli veriler için düzenli **export/backup** önerilir (bkz. [VERI_DEPOLAMA.md](VERI_DEPOLAMA.md)).
- **Senkronizasyon yok**: IndexedDB tek bir tarayıcıya/cihaza bağlıdır. Başka bir bilgisayardan aynı veriye otomatik erişemezsin — cihazlar arası taşımak için export/import (JSON/ZIP) gerekir.

## Bu Projede Nerede Kullanılıyor?

| Store | İçerik |
|---|---|
| `materials` | Üretilen her materyalin başlığı, transkripti, paragrafları, soruları, kelime listesi, kullanıcı cevapları |
| `audioCache` | Gemini TTS ile üretilen ses dosyaları (WAV, Blob olarak) |
| `folders` | Kütüphanedeki klasörler |
| `tags` | Etiketler |
| `settings` | Tema, API anahtarı, varsayılan ses/hız tercihleri |
| `studyLog` | Her "Check All" sonrası kaydedilen çalışma oturumu (skor, süre, tarih) |

Detaylı yol/yedekleme bilgisi için: [VERI_DEPOLAMA.md](VERI_DEPOLAMA.md)
