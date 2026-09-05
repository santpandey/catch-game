# ⚡ Quick Start: Image Optimization

## 🎯 Convert Stadium PNG to WebP (3 Steps)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Convert Image
```bash
npm run convert-images
```

### Step 3: Test
```bash
npm run dev
```

**That's it!** Your stadium background is now optimized. 🎉

---

## 📊 Expected Results

- **File size reduced**: 1.5 MB → 0.45 MB (70% smaller)
- **Loading time**: 3x faster
- **Visual quality**: Same or better
- **Browser support**: All modern browsers

---

## 🔍 Verify Success

Open browser console and look for:
```
✅ Stadium background loaded successfully
```

---

## 🚨 If Something Goes Wrong

### Can't install sharp?
Use online converter: https://squoosh.app
1. Upload `assets/stadium.png`
2. Choose WebP, quality 85
3. Download as `stadium.webp`
4. Place in `assets/` folder

### WebP not loading?
Temporarily revert to PNG:
```javascript
// In main.js line 3, change:
import stadiumImage from "./assets/stadium.png";
```

---

## 📚 Full Documentation

See `UPGRADE-GUIDE.md` for:
- Skybox implementation
- Advanced optimization
- Troubleshooting
- Performance tips
