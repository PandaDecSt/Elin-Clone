using System.Collections.Generic;

public class ThingStack : EClass
{
	public List<Thing> list = new List<Thing>();

	public int count;

	public int val;

	public int max;

	public void Add(Thing t)
	{
		list.Add(t);
		count += t.Num;
		if (t.Num > max)
		{
			max = t.Num;
		}
	}
}
