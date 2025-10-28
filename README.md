# 3D Cricket Slip Catch Practice Game

A browser-based 3D cricket game built with Three.js and Cannon.js physics engine, where players practice slip catches by controlling hands to catch swinging cricket balls.

## 🏏 Game Overview

The game simulates a realistic cricket slip catch practice scenario where players control hands to catch incoming cricket balls that swing in the air. Each successful catch increases the score.

## 🎮 How to Play

1. Move your mouse to control the catcher hands position
2. Position hands to catch the incoming red cricket ball
3. Each successful catch increases your score by 1
4. Game continues automatically with new throws
5. Balls come with different swing types: no swing, normal swing, and reverse swing

## 🛠️ Technology Stack

- **Three.js** - 3D graphics rendering
- **Cannon-es** - Physics simulation engine
- **Vite** - Development server and build tool
- **JavaScript (ES6)** - Core game logic
- **HTML5 Canvas** - Game rendering surface

## 🚀 Setup & Installation

### Prerequisites
- Node.js (v16 or higher)
- Modern web browser with WebGL support

### Installation Steps

```bash
# Clone the repository
git clone <repository-url>
cd catch-game

# Install dependencies
npm install

# Start development server
npm run dev

# Open your browser and navigate to http://localhost:5173
```

### Build for Production
```bash
npm run build
npm run preview
```

## 📁 Project Structure

```
catch-game/
├── assets/                     # Game assets
│   ├── hands_model.glb        # 3D hand model
│   ├── hands_animations.glb   # Hand animation clips
│   ├── stadium.png            # Stadium backdrop texture
│   └── ...                    # Other asset files
├── blender_*.py               # Blender export scripts
├── public/                    # Static files
├── index.html                 # Main HTML file
├── main.js                    # Core game logic
├── style.css                  # Game styling
├── package.json               # Dependencies and scripts
└── README.md                  # This file
```

## 🎯 Game Features

### Core Mechanics
- **Mouse Control**: Intuitive hand movement via mouse tracking
- **Realistic Physics**: Ball trajectories with gravity and swing mechanics
- **Scoring System**: Track successful catches
- **Auto-Reset**: Continuous gameplay with automatic new rounds

### Visual Elements
- **3D Environment**: Cricket stadium backdrop with grass field
- **Animated Hands**: Open and catch animations with 10% slower catch speed
- **Realistic Ball**: Red cricket ball with visible seam
- **Dynamic Lighting**: Ambient and directional lighting for depth

### Ball Physics
- **Three Swing Types**: 
  - No swing (straight trajectory)
  - Normal swing (lateral movement)
  - Reverse swing (variable direction)
- **Realistic Trajectories**: Arc-based flight paths with gravity
- **Catch Detection**: Proximity-based collision at 0.35 units distance

## 🔧 Game Controls

- **Mouse Movement**: Control catcher hands within play area
- **No Click Required**: Game is fully automated after starting
- **Play Area**: 4m width × 2m height movement zone

## 🐛 Known Issues & Fixes

- **Ball Positioning**: Fixed issue where ball appeared outside hands when caught
- **Animation Speed**: Catch animations slowed by 10% for more realistic motion
- **Continuous Attachment**: Ball now stays attached to hands during catch animation

## 📊 Performance Notes

- Target: 60 FPS gameplay
- Physics stepping: 1/60 second intervals
- Memory efficient rendering with Three.js optimization
- Responsive design adapts to window resizing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is private and proprietary.

## 🎨 Asset Credits

- 3D hand models and animations created in Blender
- Stadium texture custom-made for cricket environment
- Ball physics based on real cricket ball specifications (0.156 kg mass)

## 🔄 Future Enhancements

- Difficulty progression system
- Multiple difficulty levels
- Sound effects for catches and misses
- Player statistics tracking
- Multiplayer support
- Mobile touch controls

---

**Developed with ❤️ for cricket enthusiasts**
