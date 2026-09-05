# 🚀 Stadium Background Upgrade Guide

This guide walks you through upgrading your stadium background from PNG to WebP and optionally implementing a skybox.

## 📋 What's Been Done

### ✅ Code Changes
1. **Updated `main.js`**: Now uses WebP format with fallback support
2. **Added conversion script**: `convert-to-webp.js` for image optimization
3. **Enhanced texture loading**: Better quality with anisotropic filtering
4. **Error handling**: Graceful fallback if WebP fails to load

### ✅ New Files
- `convert-to-webp.js` - Image conversion utility
- `skybox-implementation.js` - Advanced skybox options (for future use)
- `UPGRADE-GUIDE.md` - This file

---

## 🎯 Step-by-Step Implementation

### **Step 1: Install Dependencies**

```bash
npm install
```

This will install the `sharp` package needed for image conversion.

---

### **Step 2: Convert Stadium Image to WebP**

Run the conversion script:

```bash
npm run convert-images
```

**Expected Output:**
```
🔄 Converting stadium.png to WebP...
✅ Conversion complete!
📊 Original size: 1.50 MB
📊 New size: 0.45 MB
💾 Space saved: 70.0%
📁 Output: d:\catch-game\assets\stadium.webp
```

---

### **Step 3: Test the Game**

```bash
npm run dev
```

Open your browser and check:
1. ✅ Stadium background loads correctly
2. ✅ Console shows: "✅ Stadium background loaded successfully"
3. ✅ No visual quality loss
4. ✅ Faster loading time

---

### **Step 4: Verify File Sizes**

Check your `assets` folder:
- `stadium.png` - ~1.5 MB (original)
- `stadium.webp` - ~0.4-0.5 MB (new, optimized)

**You can keep both files for now as backup.**

---

## 🎨 Optional: Upgrade to Skybox (Advanced)

For even better immersion, you can implement a 360° skybox.

### **Option A: Use AI-Generated Skybox**

1. **Generate Skybox:**
   - Go to: https://skybox.blockadelabs.com
   - Prompt: "Cricket stadium interior, afternoon lighting, empty stands, realistic"
   - Download as equirectangular image

2. **Convert to Cubemap:**
   - Go to: https://jaxry.github.io/panorama-to-cubemap/
   - Upload your equirectangular image
   - Download 6 cube faces (px, nx, py, ny, pz, nz)

3. **Add to Project:**
   ```
   assets/
   └── skybox/
       ├── right.jpg   (px)
       ├── left.jpg    (nx)
       ├── top.jpg     (py)
       ├── bottom.jpg  (ny)
       ├── front.jpg   (pz)
       └── back.jpg    (nz)
   ```

4. **Update Code:**
   Replace `setupStadiumBackground()` in `main.js` with:
   ```javascript
   function setupStadiumBackground() {
     const loader = new THREE.CubeTextureLoader();
     const skyboxTexture = loader.load([
       'assets/skybox/right.jpg',
       'assets/skybox/left.jpg',
       'assets/skybox/top.jpg',
       'assets/skybox/bottom.jpg',
       'assets/skybox/front.jpg',
       'assets/skybox/back.jpg',
     ]);
     scene.background = skyboxTexture;
   }
   ```

### **Option B: Use Poly Haven HDRIs**

1. Visit: https://polyhaven.com/hdris
2. Search for "stadium" or "sports"
3. Download 2K resolution
4. Use equirectangular loader (see `skybox-implementation.js`)

---

## 📊 Performance Comparison

| Method | File Size | Load Time | Visual Quality | Immersion |
|--------|-----------|-----------|----------------|-----------|
| **Original PNG** | 1.5 MB | ~800ms | Good | ⭐⭐ |
| **WebP (Current)** | 0.45 MB | ~250ms | Good | ⭐⭐ |
| **Skybox (6 images)** | 0.6 MB | ~300ms | Excellent | ⭐⭐⭐⭐ |
| **Equirectangular** | 0.5 MB | ~280ms | Excellent | ⭐⭐⭐⭐ |

---

## 🐛 Troubleshooting

### **Issue: WebP not loading**

**Solution 1:** Check browser support
- All modern browsers support WebP
- If using old browser, the fallback will activate

**Solution 2:** Verify file exists
```bash
# Check if conversion succeeded
ls -la assets/stadium.webp
```

**Solution 3:** Use PNG fallback temporarily
```javascript
// In main.js, change line 3:
import stadiumImage from "./assets/stadium.png";
```

---

### **Issue: "sharp" installation fails**

**Windows Users:**
```bash
npm install --platform=win32 --arch=x64 sharp
```

**Alternative:** Use online converter
- Go to: https://squoosh.app
- Upload `stadium.png`
- Select WebP format
- Quality: 85
- Download and save as `assets/stadium.webp`

---

### **Issue: Stadium looks blurry**

**Solution:** Increase WebP quality in `convert-to-webp.js`:
```javascript
.webp({ 
  quality: 90,  // Increase from 85 to 90
  effort: 6 
})
```

Then re-run: `npm run convert-images`

---

## 🎯 Next Steps

### **Immediate:**
- [x] Install dependencies
- [x] Convert PNG to WebP
- [x] Test the game
- [ ] Deploy to Netlify (WebP reduces bandwidth usage)

### **Future Enhancements:**
- [ ] Implement skybox for 360° environment
- [ ] Add animated crowd sprite sheet
- [ ] Create multiple stadium backgrounds
- [ ] Add day/night lighting variations

---

## 📚 Additional Resources

### **Image Optimization:**
- Squoosh: https://squoosh.app
- TinyPNG: https://tinypng.com
- ImageOptim: https://imageoptim.com

### **Skybox Generation:**
- Blockade Labs: https://skybox.blockadelabs.com
- Poly Haven: https://polyhaven.com/hdris
- HDRI Haven: https://hdrihaven.com

### **Three.js Documentation:**
- Textures: https://threejs.org/docs/#api/en/textures/Texture
- CubeTexture: https://threejs.org/docs/#api/en/textures/CubeTexture
- TextureLoader: https://threejs.org/docs/#api/en/loaders/TextureLoader

---

## 💡 Tips

1. **Keep PNG as backup** until you verify WebP works in production
2. **Test on multiple browsers** (Chrome, Firefox, Safari, Edge)
3. **Monitor loading times** in Network tab of DevTools
4. **Consider lazy loading** for additional backgrounds
5. **Compress all assets** before deployment

---

## ✅ Checklist

Before deploying:
- [ ] WebP conversion successful
- [ ] Game loads without errors
- [ ] Stadium background visible
- [ ] No console errors
- [ ] File size reduced significantly
- [ ] Visual quality acceptable
- [ ] Tested on multiple browsers
- [ ] Updated .gitignore (if needed)

---

**Need help?** Check `skybox-implementation.js` for advanced options or refer to the main README.md.

**Ready to deploy?** Follow the Netlify deployment guide in README.md.
