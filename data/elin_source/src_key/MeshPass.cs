using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

public class MeshPass : ScriptableObject
{
	public const int TokenLiquid = 10000;

	public const int TokenLowWall = 1000000;

	public const int TokenLowWallDefault = 3000000;

	public MeshPass subPass;

	public MeshPass snowPass;

	public MeshPass shadowPass;

	public Material mat;

	public Mesh mesh;

	public ProceduralMesh pmesh;

	public Sprite sprite;

	public bool setTile;

	public bool setColor;

	public bool setMatColor;

	public bool setExtra;

	public int renderQueue;

	public MeshPassParam _p = new MeshPassParam();

	public FilterMode filter;

	public int lastCount;

	public int lastBatchCount;

	[NonSerialized]
	public bool haveSubPass;

	[NonSerialized]
	public bool haveShadowPass;

	[NonSerialized]
	public bool haveSnowPass;

	[NonSerialized]
	public int idx;

	[NonSerialized]
	public int batchIdx;

	[NonSerialized]
	public int batchSize = 1023;

	[NonSerialized]
	public List<MeshBatch> batches = new List<MeshBatch>();

	[NonSerialized]
	private bool initialized;

	[NonSerialized]
	private bool resize;

	[NonSerialized]
	public Texture preserveTex;

	private MeshBatch _batch;

	private Vector3 tempV = Vector3.zero;

	private Vector2 tempE = Vector2.zero;

	[NonSerialized]
	private bool first = true;

	public float meshX
	{
		get
		{
			return pmesh.size.x;
		}
		set
		{
			pmesh.size.x = value;
		}
	}

	public void Init()
	{
		batchSize = ((batches.Count > 0) ? batches[0].size : 1023);
		if (!initialized || mesh == null)
		{
			if ((bool)subPass)
			{
				subPass.Init();
			}
			if ((bool)snowPass)
			{
				snowPass.Init();
			}
			if ((bool)shadowPass)
			{
				shadowPass.Init();
			}
			batches.Add(new MeshBatch(this));
			_Refresh();
			initialized = true;
		}
		idx = (batchIdx = 0);
	}

	public void Add(Point point, float tile = 0f, float color = 0f)
	{
		Vector3 vector = point.Position();
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = vector.x;
		_batch.matrices[idx].m13 = vector.y;
		_batch.matrices[idx].m23 = vector.z;
		_batch.tiles[idx] = tile;
		if (setColor)
		{
			_batch.colors[idx] = color;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Add(ref Vector3 v, float tile = 0f, float color = 0f)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = v.x;
		_batch.matrices[idx].m13 = v.y;
		_batch.matrices[idx].m23 = v.z;
		_batch.tiles[idx] = tile;
		if (setColor)
		{
			_batch.colors[idx] = color;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Add(float x, float y, float z, float tile = 0f, float color = 0f)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = x;
		_batch.matrices[idx].m13 = y;
		_batch.matrices[idx].m23 = z;
		_batch.tiles[idx] = tile;
		if (setColor)
		{
			_batch.colors[idx] = color;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void AddWithScale(float x, float y, float z, int tile, float scale)
	{
		_batch = batches[batchIdx];
		Matrix4x4[] matrices = _batch.matrices;
		float num = (0f - scale) / 2f + 0.5f;
		matrices[idx].m03 = x + num;
		matrices[idx].m13 = y + num;
		matrices[idx].m23 = z;
		matrices[idx].m00 = scale;
		matrices[idx].m11 = scale;
		_batch.tiles[idx] = tile;
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void AddShadow(MeshPassParam p, ref Vector3 fix)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].SetTRS(Vector3.zero, Quaternion.Euler(0f, 0f, 0f), Vector3.one);
		_batch.matrices[idx].m03 = p.x + fix.x;
		_batch.matrices[idx].m13 = p.y + fix.y;
		_batch.matrices[idx].m23 = p.z + fix.z;
		if (setTile)
		{
			_batch.tiles[idx] = p.tile;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void AddShadow(float x, float y, float z, ShadowData.Item s, SourcePref pref, int dir = 0, bool snow = false)
	{
		int angle = s.angle;
		float num = (float)s.scaleX * 0.01f;
		float num2 = (float)s.scaleY * 0.01f;
		bool flag = dir % 2 == 1;
		int num3 = (flag ? 1 : (-1));
		_batch = batches[batchIdx];
		Matrix4x4[] matrices = _batch.matrices;
		matrices[idx].m03 = x - 0.01f * (float)((dir < 2) ? (flag ? pref.shadowRX : pref.shadowX) : (flag ? pref.shadowBRX : pref.shadowBX)) + ((0.7f * (0f - num) + 0.7f) * (float)num3 + (float)s.x * 0.01f) * (float)num3;
		matrices[idx].m13 = y - 0.01f * (float)((dir < 2) ? (flag ? pref.shadowRY : pref.shadowY) : (flag ? pref.shadowBRY : pref.shadowBY)) + 0.6f * (0f - num2) + 0.6f + (float)s.y * 0.01f;
		matrices[idx].m23 = z;
		matrices[idx].m00 = num;
		matrices[idx].m11 = num2;
		if (angle == 0)
		{
			matrices[idx].m00 = num;
			matrices[idx].m01 = 0f;
			matrices[idx].m10 = 0f;
			matrices[idx].m11 = num2;
		}
		else
		{
			tempV.z = -angle;
			Quaternion quaternion = Quaternion.Euler(0f, 0f, -angle);
			tempE.x = 1f - quaternion.z * quaternion.z * 2f;
			tempE.y = (0f - quaternion.w) * quaternion.z * 2f;
			matrices[idx].m00 = tempE.x * num;
			matrices[idx].m01 = tempE.y * num2;
			matrices[idx].m10 = (0f - tempE.y) * num;
			matrices[idx].m11 = tempE.x * num2;
		}
		_batch.tiles[idx] = (s.tile + (snow ? 1000 : 0)) * num3;
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void AddWithRotation(float x, float y, float z, float sx, float sy, int tile, float angle, bool flip)
	{
		float num = 1f;
		float num2 = 1f;
		int num3 = ((!flip) ? 1 : (-1));
		_batch = batches[batchIdx];
		Matrix4x4[] matrices = _batch.matrices;
		matrices[idx].m03 = x + ((0.7f * (0f - num) + 0.7f) * (float)num3 + sx * 0.01f) * (float)num3;
		matrices[idx].m13 = y + 0.6f * (0f - num2) + 0.6f + sy * 0.01f;
		matrices[idx].m23 = z;
		matrices[idx].m00 = num;
		matrices[idx].m11 = num2;
		tempV.z = 0f - angle;
		Quaternion quaternion = Quaternion.Euler(0f, 0f, 0f - angle);
		tempE.x = 1f - quaternion.z * quaternion.z * 2f;
		tempE.y = (0f - quaternion.w) * quaternion.z * 2f;
		matrices[idx].m00 = tempE.x * num;
		matrices[idx].m01 = tempE.y * num2;
		matrices[idx].m10 = (0f - tempE.y) * num;
		matrices[idx].m11 = tempE.x * num2;
		_batch.tiles[idx] = tile * num3;
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Add(MeshPassParam p)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = p.x;
		_batch.matrices[idx].m13 = p.y;
		_batch.matrices[idx].m23 = p.z;
		if (setTile)
		{
			_batch.tiles[idx] = p.tile;
		}
		if (setColor)
		{
			_batch.colors[idx] = p.color;
		}
		if (setMatColor)
		{
			_batch.matColors[idx] = p.matColor;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Add(float x, float y, float z, float tile, float color, float matColor = 0f)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = x;
		_batch.matrices[idx].m13 = y;
		_batch.matrices[idx].m23 = z;
		_batch.tiles[idx] = tile;
		if (setColor)
		{
			_batch.colors[idx] = color;
		}
		if (setMatColor)
		{
			_batch.matColors[idx] = matColor;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Add(MeshPassParam p, float tile, float color, float matColor = 0f)
	{
		_batch = batches[batchIdx];
		_batch.matrices[idx].m03 = p.x;
		_batch.matrices[idx].m13 = p.y;
		_batch.matrices[idx].m23 = p.z;
		_batch.tiles[idx] = tile;
		if (setColor)
		{
			_batch.colors[idx] = color;
		}
		if (setMatColor)
		{
			_batch.matColors[idx] = matColor;
		}
		idx++;
		if (idx == batchSize)
		{
			NextBatch();
		}
	}

	public void Draw()
	{
		if (haveSnowPass)
		{
			snowPass.Draw();
		}
		if (haveSubPass)
		{
			subPass.Draw();
		}
		if (haveShadowPass)
		{
			shadowPass.Draw();
		}
		if (idx == 0 && batchIdx == 0)
		{
			return;
		}
		for (int i = 0; i < batchIdx + 1; i++)
		{
			int num = ((i == batchIdx) ? idx : batches[i].size);
			if (num == 0)
			{
				break;
			}
			if (setTile)
			{
				batches[i].mpb.SetFloatArray("_Tiles", batches[i].tiles);
			}
			if (setColor)
			{
				batches[i].mpb.SetFloatArray("_Color", batches[i].colors);
			}
			if (setMatColor)
			{
				batches[i].mpb.SetFloatArray("_MatColor", batches[i].matColors);
			}
			if (renderQueue != 0)
			{
				if (batches[i].mat == null)
				{
					batches[i].mat = new Material(mat);
				}
				batches[i].mat.renderQueue = renderQueue + i;
				Graphics.DrawMeshInstanced(mesh, 0, batches[i].mat, batches[i].matrices, num, batches[i].mpb, ShadowCastingMode.Off, receiveShadows: false, 0, Camera.main);
			}
			else
			{
				Graphics.DrawMeshInstanced(mesh, 0, mat, batches[i].matrices, num, batches[i].mpb, ShadowCastingMode.Off, receiveShadows: false, 0, Camera.main);
			}
		}
		lastBatchCount = batchIdx;
		lastCount = batchIdx * batchSize + idx;
		idx = (batchIdx = 0);
		if (resize)
		{
			Debug.Log("#pass Resize Pass:" + base.name);
			resize = false;
			batches[0] = new MeshBatch(this);
		}
	}

	public void DrawEmpty()
	{
		idx = (batchIdx = 0);
	}

	public void NextBatch()
	{
		idx = 0;
		batchIdx++;
		if (batchIdx >= batches.Count)
		{
			if (batchSize != 1023)
			{
				batchSize = 1023;
				resize = true;
			}
			batches.Add(new MeshBatch(this));
		}
	}

	private Mesh SpriteToMesh(Sprite sprite)
	{
		Mesh obj = new Mesh();
		obj.SetVertices(Array.ConvertAll(sprite.vertices, (Converter<Vector2, Vector3>)((Vector2 c) => c)).ToList());
		obj.uv = sprite.uv;
		obj.SetTriangles(Array.ConvertAll(sprite.triangles, (Converter<ushort, int>)((ushort c) => c)), 0);
		return obj;
	}

	public override string ToString()
	{
		return base.name;
	}

	public void Refresh()
	{
		if (Application.isPlaying)
		{
			UnityEngine.Object.DestroyImmediate(mesh);
			MeshPass[] passes = Core.Instance.scene.passes;
			foreach (MeshPass obj in passes)
			{
				obj.initialized = false;
				obj.batches.Clear();
				obj.Init();
			}
		}
	}

	public void OnValidate()
	{
		Refresh();
	}

	public void _Refresh()
	{
		haveSubPass = subPass;
		haveShadowPass = shadowPass;
		haveSnowPass = snowPass;
		if (!mesh)
		{
			if ((bool)pmesh)
			{
				mesh = pmesh.GetMesh();
			}
			else if ((bool)sprite)
			{
				mesh = SpriteToMesh(sprite);
			}
		}
		if (haveSnowPass)
		{
			snowPass.mesh = mesh;
		}
		if (haveSubPass)
		{
			subPass.mesh = mesh;
		}
		if (haveShadowPass)
		{
			shadowPass.mesh = mesh;
		}
	}
}
