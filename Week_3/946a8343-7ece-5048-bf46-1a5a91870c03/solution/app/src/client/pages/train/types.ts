// Response shapes of the merge train API (`GET /api/projects/<id>/train?target=`) and of its live message.
export interface TrainCar {
  iid: number;
  position: number;
  sha: string;
  pipeline_id: number | null;
  pipeline_status: string | null;
}

export interface TrainBody {
  target: string;
  cars: TrainCar[];
}
