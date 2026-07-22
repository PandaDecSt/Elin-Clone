using System;
using UnityEngine;

[Serializable]
public class RoofStyle
{
	public enum Type
	{
		None = 0,
		Default = 5,
		DefaultNoTop = 6,
		Flat = 7,
		FlatFloor = 8,
		Triangle = 9
	}

	public Type type;

	public int w;

	public int h;

	public int flatW;

	public bool useDefBlock;

	public bool reverse;

	public bool wing;

	public bool maxHeight;

	public bool coverLot;

	public Vector3 posFix;

	public Vector3 posFixBlock;

	public Vector3 lowRoofFix;

	public Vector3 snowFix;

	public float snowZ = -0.01f;

	public string GetName(int i)
	{
		if (i != 0)
		{
			return "Roof" + i;
		}
		return "None";
	}
}
