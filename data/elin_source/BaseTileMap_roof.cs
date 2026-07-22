			EMono.scene.camSupport.grading.cinemaBrightness = 0.01f * (float)cinemaConfig.brightness;
			EMono.scene.camSupport.grading.SetGrading();
			heightLightMod = 0f;
		}
		map.rooms.Refresh();
		noSlopMode = (buildMode ? (!EMono.game.config.slope) : (EInput.isAltDown && EInput.isShiftDown));
		RefreshHeight();
		innerMode = ((!buildMode && isIndoor) ? defaultInnerMode : InnerMode.None);
		if (EMono.pc.IsInActiveZone)
		{
			currentHeight = EMono.pc.pos.cell.TopHeight;
			currentRoom = EMono.pc.pos.cell.room;
		}
		else
		{
			currentHeight = 0;
			currentRoom = null;
		}
		lowObj = false;
		defaultBlockHeight = map.config.blockHeight;
		noRoofMode = false;
		bool flag = !isIndoor || EMono._zone is Zone_Tent;
		if (EMono._map.config.reverseRoof)
		{
			flag = !flag;
		}
		if (usingHouseBoard || ActionMode.Bird.IsActive)
		{
			lowBlock = (hideRoomFog = (hideHang = false));
			showRoof = (showFullWall = flag);
			if (ActionMode.Bird.IsActive)
			{
				fogBounds = false;
			}
		}
		else if (buildMode)
		{
			defaultBlockHeight = 0f;
			if (HitPoint.IsValid)
			{
				currentRoom = HitPoint.cell.room;
			}
			hideRoomFog = true;
			showRoof = flag && EMono.game.config.showRoof;
			showFullWall = showRoof || EMono.game.config.showWall;
			lowBlock = !showFullWall;
			hideHang = !showFullWall;
			if (cinemaMode)
			{
				hideRoomFog = !showRoof;
			}
		}
		else if (ActionMode.IsAdv)
		{
			noRoofMode = EMono.game.config.noRoof || screen.focusOption != null;
			if (EMono.pc.pos.cell.Front.UseLowBlock || EMono.pc.pos.cell.Right.UseLowBlock || EMono.pc.pos.cell.Front.Right.UseLowBlock || EMono.pc.pos.cell.UseLowBlock || (EMono.pc.pos.cell.Front.Right.isWallEdge && EMono.pc.pos.cell.Front.Right.Right.UseLowBlock))
			{
				if (!EMono.pc.IsMoving)
				{
					lowblockTimer = 0.1f;
				}
			}
			else if (!EInput.rightMouse.pressing)
			{
				lowblockTimer = 0f;
			}
			x = EMono.pc.pos.x;
			z = EMono.pc.pos.z;
			Room room = null;
			if (room != null)
			{
				currentRoom = room;
			}
			if (currentRoom != null)
			{
				currentRoom.data.visited = true;
			}
			if (room != null)
			{
				room.data.visited = true;
			}
			lowBlock = lowblockTimer > 0f;
			hideRoomFog = currentRoom != null && (currentRoom.HasRoof || isIndoor);
			if (hideRoomFog)
			{
				lowBlock = true;
			}
			if (noRoofMode && (currentRoom == null || currentRoom.lot.idRoofStyle == 0))
			{
				hideRoomFog = true;
				showRoof = (showFullWall = false);
			}
			else
			{
				showRoof = (showFullWall = flag && !lowBlock && !hideRoomFog);
			}
			hideHang = lowBlock;
			EMono.game.config.showRoof = !hideRoomFog;
			if (forceShowHang)
			{
				hideHang = false;
				forceShowHang = false;
			}
		}
		else
		{
			lowBlock = (hideRoomFog = (hideHang = false));
			showRoof = (showFullWall = true);
		}
		darkenOuter = !cinemaMode && !ActionMode.Bird.IsActive && !ActionMode.ViewMap.IsActive;
		currentLot = currentRoom?.lot ?? null;
				{
					DrawTile();
				}
			}
		}
		if (showRoof)
		{
			foreach (Lot item in map.rooms.listLot)
			{
				if (item.sync)
				{
					DrawRoof(item);
					item.sync = false;
					item.light = 0f;
				}
			}
		}
