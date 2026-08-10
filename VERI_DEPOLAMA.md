# Veriler Nerede Saklanıyor? (IndexedDB Açıklaması)

## Neden proje klasöründe bir "veri dosyası" göremiyorsun

**IndexedDB, proje klasörüne yazılan bir dosya değildir.** Bu bir web uygulaması (PWA) ve verileri **tarayıcının kendi iç veritabanında** saklıyor — tıpkı tarayıcı geçmişin, çerezlerin veya kayıtlı şifrelerin saklandığı yer gibi. Bu yüzden `academic-english-studio` klasörünü açıp aradığında hiçbir `.json`, `.db` veya `.sqlite` dosyası bulamıyorsun; çünkü orada değil, **tarayıcının kendi profil klasöründe**.

## Peki fiziksel olarak nerede?

Tarayıcıya göre değişir (örnek: Chrome, Windows):

```
C:\Users\ikahraman\AppData\Local\Google\Chrome\User Data\Default\IndexedDB\
```

Edge kullanıyorsan:

```
C:\Users\ikahraman\AppData\Local\Microsoft\Edge\User Data\Default\IndexedDB\
```

İçeride `http_localhost_5173_0` gibi, uygulamayı açtığın adrese (origin) göre adlandırılmış bir klasör olur. Bunun içinde ham LevelDB dosyaları vardır — **bunlar insan tarafından okunamaz ve elle açılıp düzenlenmemelidir**, tarayıcı bunları kendi iç formatında yönetir. Bu klasörü keşfetmene gerek yok; sadece "veriler gerçekten bir yerde duruyor" diye bilmen yeterli.

## Verilerini görmek istersen (tarayıcı üzerinden, güvenli yol)

1. Uygulamayı aç (`http://localhost:5173`)
2. Tarayıcıda **F12** (DevTools) → **Application** sekmesi (Chrome/Edge)
3. Sol menüde **IndexedDB → AcademicEnglishStudio**
4. Tabloları görürsün:
   - `materials` — başlık, transkript, sorular, kelimeler
   - `audioCache` — üretilen ses dosyaları (blob olarak)
   - `folders`, `tags`, `settings`, `studyLog`

Burada her satırı tıklayıp içeriğini görebilirsin.

## Bu veri ne zaman kaybolur?

| Durum | Veri kaybolur mu? |
|---|---|
| Bilgisayarı kapatıp açtın | ❌ Hayır, kalıcı |
| Tarayıcıyı kapatıp tekrar açtın | ❌ Hayır, kalıcı |
| `npm run dev` sunucusunu durdurup tekrar başlattın | ❌ Hayır, kalıcı (adres/port aynı kaldığı sürece) |
| **"Tarama verilerini temizle" / "Clear browsing data"** yaptın | ✅ Evet, kaybolur |
| Farklı bir tarayıcı kullandın (Chrome yerine Edge) | ✅ Evet, o tarayıcıda veri yok (her tarayıcının kendi IndexedDB'si ayrı) |
| Uygulamayı farklı bir adreste/portta yayınladın | ✅ Evet, farklı origin = sıfırdan boş veritabanı |
| Gizli/InPrivate pencerede kullandın | ✅ Evet, pencere kapanınca silinir |

## Güvenlik ağı: Yedekleme

Yukarıdaki riskli durumlara karşı elinde her zaman bir yedek bulunsun diye uygulamada **Export/Import** var:

- **Settings → Data → Export ZIP**: tüm kütüphaneni (metin + sorular + **ses dahil**) tek dosyada indirir, opsiyonel şifre koyabilirsin.
- **Library → materyal kartı → Export**: tek bir materyalin JSON'unu indirir (**ses içermez**, sadece metin/soru/kelime).
- **Library → çoklu seçim → Export ZIP**: seçtiğin materyalleri (ses dahil) tek zip'te indirir.
- Geri yüklemek için aynı ekranlardaki **Import** butonunu kullan; dosyayı seç, veriler IndexedDB'ye geri yazılır.

**Öneri:** Elindeki `urbanization-and-gentrification-in-modern-cities.json` gibi dosyalar sadece metin yedeği. O materyalin sesini de kalıcı olarak yedeklemek istiyorsan Library'den o materyali seçip **Export ZIP** yap.
