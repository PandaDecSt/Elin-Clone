public class RenderDataObj : RenderDataTile
{
	public override void Draw(RenderParam p)
	{
		MeshPass meshPass = ((hasSubPass && SubPassData.Current.enable) ? pass.subPass : pass);
		MeshBatch meshBatch = meshPass.batches[meshPass.batchIdx];
		int num = ((p.tile > 0f) ? 1 : (-1));
		if (useOffsetBack)
		{
			_offset = ((p.dir == 2 || p.dir == 3) ? offsetBack : offset);
		}
		if (meshPass == pass.subPass)
		{
			meshBatch.colors[meshPass.idx] = p.color - 1572864f;
			meshBatch.matrices[meshPass.idx].SetTRS(p.NewVector3 + _offset + SubPassData.Current.offset, SubPassData.Current.rotation, SubPassData.Current.scale);
		}
		else
		{
			meshBatch.colors[meshPass.idx] = p.color;
			meshBatch.matrices[meshPass.idx].m03 = p.x + _offset.x * (float)num;
			meshBatch.matrices[meshPass.idx].m13 = p.y + _offset.y;
			meshBatch.matrices[meshPass.idx].m23 = p.z + _offset.z;
		}
		meshBatch.tiles[meshPass.idx] = p.tile + (float)(p.liquidLv * 10000 * num);
		meshBatch.matColors[meshPass.idx] = p.matColor;
		meshPass.idx++;
		if (meshPass.idx == meshPass.batchSize)
		{
			meshPass.NextBatch();
		}
		if (p.snow && hasSnowPass && meshPass == pass)
		{
			meshPass = pass.snowPass;
			meshBatch = meshPass.batches[meshPass.batchIdx];
			meshBatch.colors[meshPass.idx] = p.color;
			meshBatch.matrices[meshPass.idx].m03 = p.x + _offset.x * (float)num;
			meshBatch.matrices[meshPass.idx].m13 = p.y + _offset.y;
			meshBatch.matrices[meshPass.idx].m23 = p.z + _offset.z + snowZ;
			meshBatch.tiles[meshPass.idx] = p.tile + (float)(p.liquidLv * 10000 * num);
			meshBatch.matColors[meshPass.idx] = 104025f;
			meshPass.idx++;
			if (meshPass.idx == meshPass.batchSize)
			{
				meshPass.NextBatch();
			}
		}
	}

	private void OnValidate()
	{
		_offset = offset;
	}
}
