# Default configurations for video generation to ensure smoothness
VIDEO_CONFIG = {
    "frame_rate": 60,
    "motion_strength": 0.5,
    "interpolation": "cubic",
    "resolution": "1920x1080"
}

def get_video_settings():
    return VIDEO_CONFIG
