from ytf_core.flow_bridge import FlowBridgeAdapter
from ytf_core.prompt_helpers import locked_constraints

class CreativeFlowDriver:
    """
    Driver to orchestrate Google Flow generation tasks.
    Wraps FlowBridgeAdapter with optimized defaults.
    """
    def __init__(self, output_base="output"):
        self.adapter = FlowBridgeAdapter(output_base=output_base)

    async def generate_smooth_video(self, scene_id, prompt, frame_path, duration=8.0):
        """
        Generates a smooth video using Veo 3.1 with optimized constraints.
        """
        # Enhance prompt with standard constraints for consistency
        enhanced_prompt = f"{prompt} {locked_constraints()}"
        
        return await self.adapter.generate_scene_video(
            scene_id=scene_id,
            motion_prompt=enhanced_prompt,
            start_frame_asset=frame_path,
            duration_sec=duration,
            video_model="veo-3.1-fast-ultra"  # Optimized for performance/quality
        )

    async def generate_reference_sheet(self, entity_id, prompt, aspect_ratio="16:9"):
        """
        Generates a character reference sheet using Google Flow.
        """
        return await self.adapter.generate_reference(
            entity_id=entity_id,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            image_model="nano-banana-2.1"
        )
