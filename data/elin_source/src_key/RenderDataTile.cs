public class RenderDataTile : RenderData
{
	public bool liquid;

	public float snowZ = -0.01f;

	public override void Draw(RenderParam p)
	{
		if (useOffsetBack)
		{
			_offset = ((p.dir % 4 >= 2) ? offsetBack : offset);
		}
		int num = ((p.tile % 2f == 1f || p.tile < 0f || !symmetry) ? 1 : (-1));
		int num2 = ((!(p.tile < 0f)) ? 1 : (-1));
		MeshBatch meshBatch = pass.batches[pass.batchIdx];
		meshBatch.matrices[pass.idx].m03 = p.x + _offset.x * (float)num;
		meshBatch.matrices[pass.idx].m13 = p.y + _offset.y;
		meshBatch.matrices[pass.idx].m23 = p.z + _offset.z;
		meshBatch.tiles[pass.idx] = p.tile + (float)(liquid ? (p.liquidLv * 10000 * num2) : 0);
		meshBatch.colors[pass.idx] = p.color;
		meshBatch.matColors[pass.idx] = p.matColor;
		pass.idx++;
		if (pass.idx == pass.batchSize)
		{
			pass.NextBatch();
		}
		if (multiSize)
		{
			meshBatch.matrices[pass.idx].m03 = p.x + _offset.x * (float)num;
			meshBatch.matrices[pass.idx].m13 = p.y + _offset.y + pass.pmesh.size.y;
			meshBatch.matrices[pass.idx].m23 = p.z + _offset.z + RenderData.renderSetting.vFix.z;
			meshBatch.tiles[pass.idx] = p.tile - pass.pmesh.tiling.x + (float)(liquid ? (p.liquidLv * 10000 * num2) : 0);
			meshBatch.colors[pass.idx] = p.color;
			meshBatch.matColors[pass.idx] = p.matColor;
			pass.idx++;
			if (pass.idx == pass.batchSize)
			{
				pass.NextBatch();
			}
		}
		if (p.snow && hasSnowPass)
		{
			MeshPass snowPass = pass.snowPass;
			meshBatch = snowPass.batches[snowPass.batchIdx];
			meshBatch.colors[snowPass.idx] = p.color;
			meshBatch.matrices[snowPass.idx].m03 = p.x + _offset.x * (float)num;
			meshBatch.matrices[snowPass.idx].m13 = p.y + _offset.y;
			meshBatch.matrices[snowPass.idx].m23 = p.z + _offset.z + snowZ;
			meshBatch.tiles[snowPass.idx] = p.tile + (float)(p.liquidLv * 10000 * num2);
			meshBatch.matColors[snowPass.idx] = 104025f;
			snowPass.idx++;
			if (snowPass.idx == snowPass.batchSize)
			{
				snowPass.NextBatch();
			}
		}
	}

	public override void DrawWithRotation(RenderParam p, float angle)
	{
		_ = pass.subPass;
		_ = p.NewVector3 + offset;
	}

	private void OnValidate()
	{
		_offset = offset;
	}
}
