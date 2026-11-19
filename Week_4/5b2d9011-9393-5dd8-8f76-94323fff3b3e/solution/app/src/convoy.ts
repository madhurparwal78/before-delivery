interface Pose {
  x: number;
  z: number;
  heading: number;
}

const THROTTLE_ACCEL = 10;
const TOP_SPEED = 25;
const BRAKE_DECEL = 20;
const REVERSE_TOP = 8;
const COAST_DECEL = 5;
const STEER_DEGREES_PER_SECOND = 90;

/** The browser's own car between server poses. The server judges walls, speed and wrecks. */
export class Car implements Pose {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;

  /** At race start and after each reset the car takes the server's pose with zero speed. */
  restart(pose: Pose): void {
    this.snap(pose);
    this.speed = 0;
  }

  /** A refused pose puts the car back on the server's pose. */
  snap(pose: Pose): void {
    this.x = pose.x;
    this.z = pose.z;
    this.heading = pose.heading;
  }

  step(dt: number, throttle: number, brake: number, steer: number): void {
    if (throttle > 0) this.speed = Math.min(TOP_SPEED, this.speed + THROTTLE_ACCEL * throttle * dt);
    else if (brake > 0) this.speed = Math.max(-REVERSE_TOP, this.speed - BRAKE_DECEL * brake * dt);
    else if (this.speed > 0) this.speed = Math.max(0, this.speed - COAST_DECEL * dt);
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + COAST_DECEL * dt);
    if (this.speed !== 0) this.heading += steer * STEER_DEGREES_PER_SECOND * dt;
    const radians = (this.heading * Math.PI) / 180;
    this.x += Math.cos(radians) * this.speed * dt;
    this.z += Math.sin(radians) * this.speed * dt;
  }
}
