# Creative Generation Plugin

This plugin provides optimized tools for generating high-quality images and smooth videos.

## Features
- **Prompt Engineering**: Automatically enhances user input for better model performance.
- **Video Optimization**: Pre-configured settings to ensure smooth video generation.
- **Flow Driver**: A bridge to interact directly with the Google Flow (FlowKit) generation pipeline.

## Components
- `scripts/prompt_engine.py`: Logic to enhance prompts.
- `scripts/video_settings.py`: Constants and configurations for video generation.
- `scripts/flow_driver.py`: Driver to orchestrate Flow generation tasks.

## Usage Guide
To use the Flow Driver in another project:
```python
from plugins.creative_suite.scripts.flow_driver import CreativeFlowDriver

driver = CreativeFlowDriver()
# Use driver to generate assets
```
