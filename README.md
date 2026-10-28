# PARTICLE ME

Yüzünü gerçek zamanlı olarak binlerce parçacıktan oluşan etkileşimli bir dijital portreye dönüştüren web uygulaması.

**Canlı demo:** https://berkantkull.github.io/particle-me/

React + TypeScript + Vite · Three.js / React Three Fiber · MediaPipe Face & Hand Landmarker · Tailwind CSS

## Çalıştırma

```bash
npm install        # MediaPipe WASM + modelleri public/mediapipe altına kopyalar/indirir
npm run dev        # http://localhost:5173
npm run dev:https  # LAN üzerinden HTTPS (telefonda kamera testi için, self-signed sertifika)
npm run build      # tip kontrolü + üretim derlemesi (dist/)
```

Kamera erişimi yalnızca `localhost` veya HTTPS üzerinden çalışır. `dist/` klasörü herhangi bir statik HTTPS sunucusunda yayınlanabilir.

## Kontroller

| Buton / Tuş | İşlev |
| --- | --- |
| START / STOP CAMERA | Kamerayı açar / medya akışını tamamen durdurur |
| DISPERSE (`D`) | Parçacıkları dağıtır |
| RECONSTRUCT (`R`) | Yüzü yeniden oluşturur |
| `Space` | Dağıt / birleştir arasında geçiş |
| RESET (`X`) | Parçacıkları savurup baştan birleştirir |
| CAPTURE (`C`) | Fotoğraf çeker; önizlemeden paylaş veya indir |
| `T` / 👍 | 3-2-1 geri sayımlı, elsiz selfie |
| REC | 10 sn'ye kadar video (MediaRecorder destekleniyorsa) |
| Renk | CYAN · NATURAL · AURORA · MONO |
| Q | LOW (10K) · MEDIUM (20K) · HIGH (35K) · ULTRA (70K) parçacık |

El hareketleri: **açık avuç** → dağıt, **yumruk** → birleştir, **başparmak yukarı** → geri sayımlı fotoğraf, **el hareketi** → parçacıkları iter ve girdap oluşturur.

Çekilen fotoğraf ve videolar önizleme kartında açılır; **PAYLAŞ** cihazın paylaşım menüsünü (WhatsApp, Instagram…) açar, **İNDİR** dosyayı kaydeder.

## Mimari

- **Algılama** (`src/lib/tracker.ts`): MediaPipe kendi zamanlayıcısında, render döngüsünden bağımsız ve kaliteye göre kısıtlanmış hızda çalışır. Sonuçlar React state yerine paylaşılan, değiştirilebilir bir nesneye yazılır.
- **Yüz kırpımı + maske**: her algılamada yüz bölgesi 384×384'lük bir canvas'a kırpılır ve aynı kırpım alanında yüz ovalinden yumuşak kenarlı bir maske çizilir. İkisi sıradan doku olarak GPU'ya yüklenir (vertex shader'da VideoTexture okumak bazı GPU'larda siyah döndüğü için). Yüz dışındaki parçacıklar portrenin etrafında dönen soluk bir haleye dönüşür.
- **Otomatik seviyeler**: yüz bölgesinin 32×32'lik küçültülmüş kopyasından parlaklık aralığı ölçülür; loş veya yandan aydınlatılmış yüzler de tam kontrastla görünür.
- **Parçacıklar** (`src/three/`): GPGPU (GPUComputationRenderer) ile konum/hız dokuları GPU'da simüle edilir. Her parçacığın yüz kırpımı içinde sabit bir "ev" koordinatı vardır (altın açı spirali). Hedef konum, renk ve derinlik GPU'da yüz kırpımı dokusundan örneklenir; kamera görüntüsü hiçbir karede büyük CPU dizilerine dönüştürülmez.
- **Kuvvetler**: yaya bağlı birleşme (parçacık başına kademeli), akış alanı + küresel kabuk ile dağılma, tek seferlik patlama itkisi, el konumunda itme + girdap.
- **Adaptif kalite**: başlangıç kalitesi cihaza göre seçilir; FPS uzun süre 40'ın altında kalırsa kalite otomatik düşer (kullanıcı elle seçince devre dışı kalır).

## Gizlilik

Tüm görüntü işleme tarayıcıda yapılır; kamera görüntüsü hiçbir sunucuya gönderilmez. MediaPipe çalışma zamanı ve modelleri uygulamayla birlikte sunulur. Kaydedilen PNG/video dosyaları doğrudan cihazda oluşturulur.

## Yayın

`main` dalına yapılan her push, GitHub Actions ile otomatik olarak derlenip GitHub Pages'te yayınlanır (`.github/workflows/deploy.yml`).

## Lisans

© 2026 Berkant Kul. [MIT](LICENSE) lisansı ile yayınlanmıştır.
