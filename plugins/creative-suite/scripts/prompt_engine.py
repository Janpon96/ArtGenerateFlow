def enhance_prompt(user_input, style="cinematic"):
    """
    Enhances a simple user prompt with quality keywords.
    """
    enhancements = {
        "cinematic": "cinematic, highly detailed, 8k resolution, dramatic lighting, professional photography",
        "smooth_video": "smooth motion, high frame rate, fluid camera movement, consistent quality"
    }
    
    style_suffix = enhancements.get(style, "")
    return f"{user_input}, {style_suffix}"
