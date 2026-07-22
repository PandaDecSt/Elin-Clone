using System.Collections.Generic;
using UnityEngine;

public class RenderDataThing : RenderDataCard
{
	public List<Sprite> sprites;

	public float frameTime;

	public override string prefabName => "ThingActor";

	private void OnValidate()
	{
		_offset = offset;
	}
}
