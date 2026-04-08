import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CheckMailVerfiy } from './check-mail-verfiy';

describe('CheckMailVerfiy', () => {
  let component: CheckMailVerfiy;
  let fixture: ComponentFixture<CheckMailVerfiy>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CheckMailVerfiy]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CheckMailVerfiy);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
